# 09 · IA y tickets

Requisitos: RF-TIC-01 a 06, RF-COM-03, RF-ADM-02, RNF-03, RNF-06. Decisiones: T12, T14, D2 (spike C).

## 1. Gateway de IA

Único punto que conoce proveedores y la API key (`apps/api/src/ai/`).

```ts
// apps/api/src/ai/types.ts
export interface AiUsage { provider: string; model: string; input_tokens: number | null;
                           output_tokens: number | null; cost_usd: number | null }

export interface AiProvider {
  extractReceipt(imageUrls: string[], systemPrompt: string, schema: object):
    Promise<{ data: unknown; usage: AiUsage }>;
  editImage?(imageUrl: string, prompt: string): Promise<{ image: ArrayBuffer; mime: string; usage: AiUsage }>;  // E3
}

// apps/api/src/ai/gateway.ts
export function providerFor(env: Env, purpose: 'receipt' | 'image_edit'): AiProvider {
  const name = purpose === 'receipt' ? env.AI_RECEIPT_PROVIDER : env.AI_IMAGE_EDIT_PROVIDER;
  const model = purpose === 'receipt' ? env.AI_RECEIPT_MODEL : env.AI_IMAGE_EDIT_MODEL;
  if (!model || model.startsWith('<')) throw new ApiError(503, 'AI_UNAVAILABLE');
  switch (name) {
    case 'openrouter': return new OpenRouterProvider(env, model);
    default: throw new ApiError(503, 'AI_UNAVAILABLE');
  }
}
```

```ts
// apps/api/src/ai/providers/openrouter.ts
export class OpenRouterProvider implements AiProvider {
  constructor(private env: Env, private model: string) {}

  async extractReceipt(imageUrls: string[], systemPrompt: string, schema: object) {
    const res = await fetchWithTimeout('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': this.env.PUBLIC_BASE_URL,
        'X-Title': 'Ahorrando Maunedas',
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: [
              { type: 'text', text: 'Extrae este ticket.' },
              ...imageUrls.map((url) => ({ type: 'image_url', image_url: { url } })),
          ] },
        ],
        response_format: { type: 'json_schema', json_schema: { name: 'receipt', strict: true, schema } },
      }),
    }, 60_000);

    if (res.status >= 500 || res.status === 429) throw new RetryableAiError(res.status);
    if (!res.ok) throw new ApiError(502, 'UPSTREAM_ERROR', { service: 'openrouter', status: res.status });

    const json = await res.json<any>();
    const content: string | undefined = json.choices?.[0]?.message?.content;
    if (!content) throw new InvalidAiOutput('sin contenido');
    return {
      data: JSON.parse(content),
      usage: {
        provider: 'openrouter',
        model: json.model ?? this.model,
        input_tokens: json.usage?.prompt_tokens ?? null,
        output_tokens: json.usage?.completion_tokens ?? null,
        cost_usd: typeof json.usage?.cost === 'number' ? json.usage.cost : null,   // costo real reportado
      },
    };
  }
}
```

Reintentos: un reintento ante `RetryableAiError`, timeout o `InvalidAiOutput`. El modelo elegido debe soportar salida con `json_schema` (criterio del spike C).

## 2. Presupuesto

- Mes = mes calendario en hora del centro de México (UTC−6 fijo, sin horario de verano).
- Antes de llamar: `gastado + estimado > tope` → `402 E-AI_BUDGET_EXCEEDED`. Estimado = `AI_RECEIPT_EST_COST_USD`.
- Después de llamar (éxito o error de salida): registrar `ai_usage` con el costo reportado; si no viene, el estimado.
- Al cruzar `AI_SOFT_LIMIT_PCT`: aviso al admin una vez por mes (marca `ai_soft:<YYYY-MM>` en `token_cache`). En la Etapa 1 el aviso es un banner en W-13 y en `GET /v1/admin/ai-budget` (`soft_limit_reached`); el push llega con FCM en T-213.
- Red de seguridad: límite mensual de 6 USD configurado en la propia key de OpenRouter.

```ts
// apps/api/src/ai/budget.ts
const MX_OFFSET_MS = 6 * 3_600_000;

export function monthWindow(nowMs: number) {
  const local = new Date(nowMs - MX_OFFSET_MS);
  const y = local.getUTCFullYear(), m = local.getUTCMonth();
  return {
    key: `${y}-${String(m + 1).padStart(2, '0')}`,
    start: Date.UTC(y, m, 1) + MX_OFFSET_MS,
    end: Date.UTC(y, m + 1, 1) + MX_OFFSET_MS,
  };
}

export async function spentThisMonthUsd(db: D1Database, nowMs = Date.now()): Promise<number> {
  const { start } = monthWindow(nowMs);
  const r = await db.prepare(`SELECT COALESCE(SUM(cost_usd_micros), 0) AS s FROM ai_usage WHERE created_at >= ?1`)
    .bind(start).first<{ s: number }>();
  return (r?.s ?? 0) / 1e6;
}

export async function assertBudget(env: Env, estimateUsd: number): Promise<void> {
  const spent = await spentThisMonthUsd(env.DB);
  const budget = Number(env.AI_MONTHLY_BUDGET_USD);
  if (spent + estimateUsd > budget) {
    throw new ApiError(402, 'AI_BUDGET_EXCEEDED', { spent_usd: spent, budget_usd: budget });
  }
}
```

## 3. Flujo del ticket

```
Android: Escáner de documentos (1–4 páginas) ─┐
Web: <input capture> + reducción a 1600 px ───┴─► compra 'draft' + images(role='receipt', owner=purchase)
                                                  (Android: offline OK; binarios en pending_uploads)
Con red y binarios subidos:
  POST /v1/receipts/extract ──► resultado con líneas, coincidencias y sugerencias
  Revisión (S-06 / W-06) ──► Confirmar: compra 'confirmed' + líneas + promociones + alias + códigos nuevos (un push)
```

## 4. `POST /v1/receipts/extract`

### 4.1 Pasos en el Worker

1. Validar cuerpo (`image_ids` 1..4). Cada imagen debe existir, tener `role='receipt'` y su original en R2 (`HEAD`) → si no, `409 E-IMAGE_NOT_UPLOADED`.
2. `images_key = sha256(ids ordenados unidos por ",")`. Si no hay `force` y existe una extracción `ok` con esa llave → se reutiliza (`reused: true`) y solo se recalculan coincidencias.
3. Límite: > 40 extracciones del usuario en el día local → `429 E-RATE_LIMITED`.
4. `assertBudget`.
5. URLs firmadas de 10 min para cada página (`10-imagenes.md` §3).
6. Llamar al proveedor con el prompt (§4.2) y el esquema (§4.3). Validar con Zod.
7. Registrar `ai_usage` y `receipt_extractions` (`result_json` = salida del modelo).
8. Convertir a centavos (§4.4), adivinar tienda (§5.4), vincular líneas (§5), adivinar promociones (§6).
9. Responder (§4.5).

CPU: las coincidencias se calculan solo contra candidatos preseleccionados por SQL (§5.3) para no pasar de 10 ms en el plan Free.

### 4.2 Prompt de sistema

```text
Eres un extractor de tickets de compra de tiendas de México. Recibirás de 1 a 4 fotos de UN solo ticket, en orden de página.
Devuelve únicamente JSON que cumpla el esquema. Reglas:
1. store_name: nombre comercial de la tienda (por ejemplo "Bodega Aurrera", "Sam's Club", "Farmacias Guadalajara"), no la razón social (por ejemplo "Nueva Wal Mart de México S de RL de CV"). Si no se lee, null.
2. purchased_at: fecha y hora del ticket en ISO 8601 con zona -06:00. Si falta la hora, usa 12:00:00. Si no hay fecha, null.
3. lines: un elemento por artículo, en el orden del ticket.
   - raw_text: la descripción tal como aparece, SIN cantidades, pesos, códigos ni precios.
   - barcode: código numérico impreso para ese artículo, si existe; si no, null.
   - quantity: unidades; en productos pesados, kilogramos con decimales. Si no aparece, 1.
   - sold_by_weight: true si la línea muestra peso en kg y precio por kg.
   - unit_price: precio por unidad (o por kg) en pesos, antes de descuentos. null si no aparece.
   - amount: importe de la línea en pesos antes de descuentos.
   - discount: suma en pesos (positiva) de los descuentos que el ticket asocia a ESTE artículo, por ejemplo líneas "DESC", "AHORRO", "2X1" o precios negativos que lo siguen. 0 si no hay.
   - promo_text: texto de esa promoción, si existe; si no, null.
4. ticket_discounts: descuentos que aplican a todo el ticket (cupones generales), en pesos positivos.
5. Ignora forma de pago, cambio, IVA desglosado, puntos, publicidad y datos fiscales.
6. subtotal y total: como aparecen en el ticket; null si no se leen.
7. Si una línea es ilegible, inclúyela con raw_text "ILEGIBLE" y los números que sí se lean.
8. No inventes artículos ni montos.
```

### 4.3 Esquema de salida del modelo

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["store_name", "purchased_at", "lines", "ticket_discounts", "subtotal", "total"],
  "properties": {
    "store_name": { "type": ["string", "null"] },
    "purchased_at": { "type": ["string", "null"] },
    "lines": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["raw_text", "barcode", "quantity", "sold_by_weight", "unit_price", "amount", "discount", "promo_text"],
        "properties": {
          "raw_text": { "type": "string" },
          "barcode": { "type": ["string", "null"] },
          "quantity": { "type": "number" },
          "sold_by_weight": { "type": "boolean" },
          "unit_price": { "type": ["number", "null"] },
          "amount": { "type": "number" },
          "discount": { "type": "number" },
          "promo_text": { "type": ["string", "null"] }
        }
      }
    },
    "ticket_discounts": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["description", "amount"],
        "properties": { "description": { "type": "string" }, "amount": { "type": "number" } }
      }
    },
    "subtotal": { "type": ["number", "null"] },
    "total": { "type": ["number", "null"] }
  }
}
```

### 4.4 Conversión

Por línea (`pesos → centavos` con redondeo half-up):

| Campo | Regla |
|---|---|
| `quantity` | `> 0`; si viene ≤ 0, se usa 1 y se agrega advertencia |
| `gross_cents` | `round(amount × 100)` |
| `unit_price_cents` | `round(unit_price × 100)` si viene; si no, `round(gross / quantity)` |
| `discount_cents` | `round(discount × 100)`, acotado a `[0, gross]` |
| `final_cents` | `gross − discount` |
| Advertencia | Si `|quantity × unit_price − amount| > 1 peso` → "Revisa la línea N: cantidad × precio no coincide con el importe" |

Totales: `lines_final_sum = Σ final`, `ticket_disc = Σ ticket_discounts`, `mismatch = (lines_final_sum − ticket_disc) − total` (null si no hay total).

### 4.5 Respuesta

```ts
// 200
{
  extraction_id: Id;
  reused: boolean;
  model: string;
  cost_usd: number;                                   // 0 si reused
  store: { guess_store_id: Id | null; printed_name: string | null };
  purchased_at: Millis | null;
  lines: Array<{
    line_no: number;
    raw_text: string;
    raw_text_norm: string;
    quantity: number;
    sold_by_weight: boolean;
    unit_price_cents: Cents;
    gross_cents: Cents;
    discount_cents: Cents;
    final_cents: Cents;
    barcode: string | null;
    promo_text: string | null;
    promo_guess: { type: PromoType; params: Record<string, unknown> } | null;
    match: { variant_id: Id; method: 'alias' | 'barcode' } | null;
    suggestions: Array<{ variant_id: Id; product_name: string; variant_label: string; score: number }>;  // máx. 3
  }>;
  ticket_discounts: Array<{ description: string; amount_cents: Cents }>;
  subtotal_cents: Cents | null;
  total_cents: Cents | null;
  lines_final_sum_cents: Cents;
  mismatch_cents: Cents | null;
  warnings: string[];
}
```

| Error | Cuándo |
|---|---|
| `402 E-AI_BUDGET_EXCEEDED` | Tope alcanzado |
| `409 E-IMAGE_NOT_UPLOADED` | Falta subir alguna página |
| `422 E-EXTRACTION_FAILED` | Salida inválida tras el reintento (se registra el costo) |
| `429 E-RATE_LIMITED` | > 40 por usuario al día |
| `503 E-AI_UNAVAILABLE` | Modelo no configurado o proveedor caído |

## 5. Vinculación de líneas

### 5.1 Texto normalizado (`raw_text_norm`)

`packages/shared/src/receipts/normalize.ts` (y Kotlin `ReceiptText`), casos en `fixtures/textos.json`:

1. Descomponer (NFKD), quitar acentos, pasar a mayúsculas.
2. Quitar código numérico de 8–14 dígitos al inicio o al final.
3. Quitar prefijo de cantidad: `^\d+(\.\d+)?\s*(X|@|\*)\s+`.
4. Quitar hasta dos precios al final: `(\s+\$?\d+[.,]\d{2})$`.
5. Quitar pesos de báscula: `\b\d+\.\d{3}\s*KG\b`.
6. Reemplazar todo carácter que no sea `A-Z`, `0-9`, espacio, `%` o `.` por espacio; luego quitar los `.` que no estén entre dígitos.
7. Colapsar espacios y recortar.

### 5.2 Coincidencia exacta

En orden:
1. **Alias**: `receipt_aliases` vivo con `(store_id, raw_text_norm)` → `method: 'alias'`.
2. **Código**: `barcode` normalizado con 8–14 dígitos que exista en `barcodes` → `method: 'barcode'`.

### 5.3 Sugerencias (líneas sin coincidencia exacta)

1. Expandir abreviaturas con el diccionario compartido (`packages/shared/src/receipts/abbreviations.ts`), p. ej. `LCH→LECHE`, `ENT→ENTERA`, `DESC→DESCREMADA`, `DET→DETERGENTE`, `JAB→JABON`, `PAP→PAPEL`, `HIG→HIGIENICO`, `ACON→ACONDICIONADOR`, `REF→REFRESCO`, `GALL→GALLETAS`, `YOG→YOGURT`, `QSO→QUESO`, `JAM→JAMON`, `PECH→PECHUGA`, `ACEIT→ACEITE`, `AZUC→AZUCAR`, `SUAV→SUAVIZANTE`, `DESOD→DESODORANTE`. Se amplía con el uso. `DESC` no se expande si el siguiente token empieza con dígito o `%` ("DESC 15%" es un descuento, no "descremada").
2. Tokens = palabras de ≥ 2 caracteres en minúsculas (misma normalización que `searchKey`).
3. Candidatos por SQL: productos cuyo `search_key` contiene alguno de los 2 tokens más largos (`LIKE '%tok%'`), máximo 50.
4. Para cada variante candidata, `score = (Σ peso de tokens de la línea encontrados en "producto marca etiqueta_variante") / (número de tokens de la línea)`, con peso 1.0 si el token coincide completo y 0.7 si es prefijo (≥ 3 letras) de un token del candidato. Bono +0.15 si el contenido de la línea (p. ej. `1L`, `900G`) coincide con el de la variante.
5. Devolver las 3 mejores con `score ≥ 0.35`.

### 5.4 Tienda

`store_name` normalizado se compara contra `stores.name` y un diccionario de sinónimos (`packages/shared/src/receipts/stores.ts`): p. ej. `WALMART ← WAL MART, WALMART SUPERCENTER, WALMART EXPRESS`; `BODEGA AURRERA ← AURRERA, MI BODEGA`; `SAM'S CLUB ← SAMS, SAM S CLUB`; `FARMACIAS SIMILARES ← SIMILARES`. Se ignora la razón social `NUEVA WAL MART DE MEXICO`, que aparece en tickets de varias cadenas del grupo. Si el cliente mandó `store_id`, gana ese.

## 6. Promociones

### 6.1 Fórmulas (`packages/shared/src/pricing/promotions.ts`, Kotlin `Promotions`)

| `type` | `params` | Descuento de la línea (centavos, half-up) |
|---|---|---|
| `price_cut` | `from_cents`, `to_cents` | `(from − to) × cantidad` |
| `percent` | `percent` | `precio × cantidad × percent / 100` |
| `nxm` | `n`, `m` | `⌊cantidad / n⌋ × (n − m) × precio` |
| `nth_unit_discount` | `nth`, `percent` | `⌊cantidad / nth⌋ × precio × percent / 100` |
| `member_price` | `member_cents` | `(precio − member) × cantidad` |
| `coupon` | `amount_cents` o `percent` | el monto, o `precio × cantidad × percent / 100` |
| `msi` | `months` | 0 (`affects_price = 0`) |
| `bundle` / `other` | `amount_cents` | el monto |

Redondeo half-up: `roundHalfUp(x) = floor(x + 0.5)` en TS y Kotlin (igual a `Math.round` de JS/Java); nunca `kotlin.math.round`, que redondea a par. El descuento se acota a `[0, bruto]` con `bruto = roundHalfUp(cantidad × precio)`. Si falta un parámetro requerido del tipo, la función lanza error.

Casos en `fixtures/promociones.json` (`descuentos`).

### 6.2 Detección desde texto del ticket

`promo_guess` a partir de `promo_text` (o `raw_text` si no hay), en este orden; casos en `fixtures/promociones.json` (`deteccion`).

Contrato: `detectPromotion(text) → { type, params } | null`. El texto se normaliza (sin acentos, mayúsculas, espacios colapsados). Texto vacío → `null`; texto sin patrón conocido → `other { text }` con el texto original recortado. La condición "descuento > 0" la aplica quien llama (`promo_guess` solo se calcula para líneas con descuento o `promo_text`).

| Patrón (sobre texto normalizado) | Resultado |
|---|---|
| `(\d+)\s*MSI` o `MESES SIN INTERESES` | `msi {months}` |
| `\b([2-9])\s*X\s*([1-8])\b` con n > m | `nxm {n, m}` |
| `(2DA\|SEGUNDA\|2A)\b.*?(\d{1,3})\s*%` | `nth_unit_discount {nth: 2, percent}` |
| `SOCIO\|MEMBRESIA\|MEMBER` | `member_price {}` |
| `CUPON\|COUPON` | `coupon {}` |
| `(\d{1,3})\s*%` | `percent {percent}` |
| `REBAJA\|AHORRO\|DESC\|DESCUENTO\|BAJA DE PRECIO` | `price_cut {}` |
| cualquier otro texto con descuento > 0 | `other {text}` |

El **monto** siempre es el del ticket (`discount_cents`); el tipo solo clasifica.

## 7. Confirmación (cliente)

Al tocar **Confirmar compra** en S-06 / W-06, en una transacción (Android) o un push (web):

1. `purchases`: `status='confirmed'`, `source='receipt_ai'`, tienda, fecha (la del ticket si el usuario no la cambió), `subtotal_cents`, `total_cents`, `discount_cents = Σ ticket_discounts`.
2. `purchase_items`: una por línea (las marcadas "no es producto" con `variant_id = null`).
3. `promotions`: una por línea con descuento (`purchase_item_id`), y una por descuento de ticket (`purchase_id`, tipo `coupon` u `other`).
4. `receipt_aliases`: por cada línea vinculada **manualmente o por sugerencia** con `raw_text_norm` distinto de `ILEGIBLE`: `id = uuidv5(NS_RECEIPT_ALIASES, store_id + ':' + raw_text_norm)`.
5. `barcodes`: si la línea traía código de 8–14 dígitos que no existe localmente → nuevo código `source='receipt'` para la variante elegida.

## 8. Costos esperados

Una extracción usa 1–4 imágenes de entrada y ~1–2 mil tokens de salida para un ticket largo. Con un modelo de visión económico se espera **menos de 1 centavo de dólar por ticket**; 100 tickets al mes quedan muy por debajo del tope de 6 USD. El valor real se mide en el spike C con el costo que reporta OpenRouter.

## 9. Spike C (T-012)

- Tickets: Walmart o Bodega Aurrera, Costco, Soriana, una farmacia, OXXO (uno largo de ≥ 30 líneas).
- Modelos: 2–3 de visión con soporte de `json_schema` en OpenRouter.
- Métricas por modelo: líneas detectadas / reales, importes correctos, total correcto, tienda y fecha correctas, costo y latencia.
- **Aprobado si**: ≥ 95 % de importes correctos en 4 de 5 tickets y costo ≤ 0.02 USD por ticket. El ganador se fija en `AI_RECEIPT_MODEL` y se registra en `ESTADO.md` (D2).
