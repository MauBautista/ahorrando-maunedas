# 10 · Imágenes

Requisitos: RF-CAT-06, RF-IMG-01 a 06, RF-TIC-01. Tablas: `images` (sync, del cliente), `image_renditions` (sync, append-only), `image_jobs` (servidor). Niveles T0–T3 en `ARQUITECTURA.md` §9.

## 1. Conceptos

| Concepto | Valores |
|---|---|
| `images.role` | `catalog` (foto del producto o variante) · `receipt` (página de ticket) · `shelf_photo` (foto de anaquel) |
| `images.source` | `user` (tomada por alguien) · `off` (catálogo abierto) · `generated` (IA) |
| `image_renditions.kind` | `mask` (PNG, alfa) · `processed` (WebP con alfa, ≤ 1024 px) · `thumb` (WebP sobre fondo, 256 px) |
| `image_renditions.tier` | `catalog` · `device` (T1) · `home` (T2) · `ai` (T3) · `manual` (editor) |
| Selección | `images.selected_processed_id` y `selected_thumb_id` apuntan a las renditions en uso |

Qué se muestra:

| Uso | Prioridad |
|---|---|
| Miniatura en listas | `selected_thumb` → `selected_processed` → original |
| Foto grande | `selected_processed` (sobre el fondo de `edit_params.background`, blanco por defecto) → original |
| Ticket | Siempre el original |

Claves R2 (inmutables): `images/{image_id}/original.{jpg|png|webp}` y `images/{image_id}/{rendition_id}.{webp|png}`.

## 2. Catálogo abierto (T0)

### 2.1 Consulta (`GET /v1/barcodes/:code`)

1. Normalizar a dígitos; aceptar 6–14 → si no, `400 E-INVALID_BARCODE`.
2. Buscar en `barcodes` vivos → `match`.
3. Si no hay `match`: `off_cache` (vigente si `found=1` y < 30 días, o `found=0` y < 7 días).
4. Si no hay caché: consultar en orden **Open Food Facts → Open Beauty Facts → Open Products Facts** hasta encontrar:
   ```
   GET https://world.openfoodfacts.org/api/v2/product/{code}.json?fields=product_name,product_name_es,brands,quantity,image_front_url,image_url
   (mismo camino en world.openbeautyfacts.org y world.openproductsfacts.org)
   User-Agent: <OFF_USER_AGENT>
   ```
5. Guardar en `off_cache` el JSON recortado (o `found=0`).

Mapeo a `catalog`:

| Campo | Origen |
|---|---|
| `name` | `product_name_es` → `product_name` |
| `brand` | primer elemento de `brands` (separado por comas) |
| `quantity_text` | `quantity` |
| `parsed` | `parseQuantity(quantity)` (§2.2) |
| `image_url` | `image_front_url` → `image_url` |
| `license` / `attribution` | Imágenes CC BY-SA, atribución "Open Food Facts contributors" (o el proyecto correspondiente) |
| `source_url` | `https://world.openfoodfacts.org/product/{code}` (o equivalente) |

### 2.2 Interpretar el contenido (`parseQuantity`)

`packages/shared/src/catalog/quantity.ts` y Kotlin `QuantityParser`; casos en `fixtures/cantidades.json`.

1. Minúsculas, sin acentos, coma decimal → punto.
2. Unidades reconocidas:

| Texto | Medida | Factor a base |
|---|---|---|
| `mg` | mass | 0.001 |
| `g`, `gr`, `grs`, `gramos` | mass | 1 |
| `kg`, `kgs`, `kilo`, `kilos` | mass | 1000 |
| `oz` | mass | 28.3495 (se redondea a entero) |
| `ml`, `mililitros` | volume | 1 |
| `cl` | volume | 10 |
| `l`, `lt`, `lts`, `litro`, `litros` | volume | 1000 |
| `fl oz` | volume | 29.5735 (se redondea a entero) |
| `pz`, `pza`, `pzas`, `pieza`, `piezas`, `u`, `unidades`, `rollos`, `tabletas`, `capsulas`, `sobres` | count | 1 |

3. Patrones, en orden: `N x Q unidad` → paquete N de Q; `Q unidad x N` → paquete N de Q; `Q unidad` → paquete 1. (`x`, `×` o `*`.)
4. Si hay varias coincidencias sueltas, se prefiere la primera en unidades métricas sobre `oz`.
5. Sin coincidencia → `null`.

Etiqueta sugerida (`suggestVariantLabel`): `"{N} × {Q}"` si N > 1; volumen ≥ 1000 ml en L, masa ≥ 1000 g en kg, piezas como `pz`; decimales sin ceros sobrantes (`1.5 L`).

### 2.3 Importar la foto del catálogo

El cliente crea la fila `images` (`source='off'`, `role='catalog'`, licencia, atribución, `source_url`, `original_key = images/{id}/original.jpg`) por sync y luego:

```http
POST /v1/images/{imageId}/import
{ "source_url": "https://images.openfoodfacts.org/…" }
→ 201 { "key": "images/{imageId}/original.jpg", "bytes": 81234 }
```

- Hosts permitidos: `images.openfoodfacts.org`, `static.openfoodfacts.org`, `images.openbeautyfacts.org`, `images.openproductsfacts.org`.
- Host fuera de la lista → `400 E-VALIDATION_ERROR` con `details.reason = 'HOST_NOT_ALLOWED'`.
- Máximo 10 MB; debe ser `image/*`. Se guarda tal cual (sin recorte).
- En Android, si no hay red en ese momento, se agrega a `pending_uploads` con `kind='import'` y `source_url` (04 §6.1).

## 3. URLs firmadas

```ts
// apps/api/src/images/signing.ts
const WINDOW_MS = 6 * 3_600_000;

/**
 * Firma una ruta. Con TTL ≥ 24 h, exp se redondea a ventanas de 6 h para que la URL sea estable y cacheable;
 * con TTL corto (10 min para IA) se usa el vencimiento exacto, para que no valga horas.
 */
export async function signPath(secret: string, path: string, ttlMs: number, now = Date.now()): Promise<string> {
  const exp = ttlMs >= 24 * 3_600_000 ? Math.ceil((now + ttlMs) / WINDOW_MS) * WINDOW_MS : now + ttlMs;
  const sig = await hmacHex(secret, `${path}:${exp}`);
  return `${path}?exp=${exp}&sig=${sig}`;
}

export async function verifySigned(secret: string, path: string, exp: string | undefined,
                                   sig: string | undefined, now = Date.now()): Promise<boolean> {
  if (!exp || !sig || Number(exp) < now) return false;
  return timingSafeEqualHex(await hmacHex(secret, `${path}:${exp}`), sig);
}

async function hmacHex(secret: string, msg: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
```

| Uso | TTL |
|---|---|
| `ImageRef` en respuestas de consulta (web) | 24 h |
| Páginas de ticket para OpenRouter | 10 min |
| Original para IA de imagen (E3) | 10 min |

## 4. Subida

### 4.1 Worker: `PUT /v1/images/:imageId/blobs/:name`

1. `name` debe cumplir `^(original\.(jpg|png|webp)|[0-9a-f-]{36}\.(webp|png))$`.
2. `Content-Type` acorde a la extensión (`image/jpeg`, `image/png`, `image/webp`) → si no, `415`.
3. `Content-Length` ≤ 15 MB → si no, `413`.
4. Original: la fila `images` existe y `original_key = images/{imageId}/{name}`. Rendition: la fila `image_renditions` existe, `r2_key` coincide y `tier ∈ {device, manual}`. Si no → `409 E-IMAGE_NOT_FOUND`.
5. `IMAGES.put(key, request.body, { httpMetadata: { contentType } })` en streaming (si el runtime exige longitud conocida, envolver en `FixedLengthStream(contentLength)`).
6. `201 { key, bytes }`. Subir de nuevo la misma clave es idempotente.

`GET /v1/images/:imageId/blobs/:name`: acepta Bearer o firma; responde el objeto de R2 con `Cache-Control: private, max-age=31536000, immutable` y `ETag`.

### 4.2 Android

```
Cámara / galería / escáner de documentos
  → reducir (producto ≤ 2048 px JPEG 85 · ticket ≤ 1600 px JPEG 80), respetando EXIF
  → guardar en filesDir/images/{imageId}/original.jpg
  → LocalWriter: images (+ renditions si hubo T1) y outbox
  → pending_uploads: original (+ renditions)
UploadWorker (CONNECTED, backoff exponencial):
  para cada pending_upload en orden de creación:
    si la fila images/rendition aún está en outbox → saltar (se sube después del push)
    PUT /v1/images/{imageId}/blobs/{name}
    201 → borrar de pending_uploads (el archivo local se conserva como caché)
    409 IMAGE_NOT_FOUND → reintentar en la siguiente corrida
    413/415 → sync_issue y borrar de pending_uploads
```

Coil: si existe el archivo local, lo usa; si no, pide `/v1/images/{id}/blobs/{name}` con el `AuthInterceptor`. Ajustes → Almacenamiento → "Liberar espacio" borra originales locales ya subidos.

### 4.3 Web

`06-web.md` §5. Orden: push de las filas → `PUT` de binarios → uso (extracción, visualización).

## 5. Recorte en el teléfono (T1, opcional en E1)

```kotlin
class SubjectCutter @Inject constructor() {
    private val segmenter = SubjectSegmentation.getClient(
        SubjectSegmenterOptions.Builder().enableForegroundBitmap().build()
    )

    /** Devuelve el sujeto con fondo transparente, o null si no detecta nada. */
    suspend fun cut(bitmap: Bitmap): Bitmap? =
        segmenter.process(InputImage.fromBitmap(bitmap, 0)).await().foregroundBitmap
}
```

Posproceso (`core:camera`, `ProductImageRenderer`):
1. Recortar al rectángulo de píxeles con alfa > 0.
2. Centrar en lienzo cuadrado con 8 % de margen.
3. `processed`: WebP con alfa, lado ≤ 1024 (API ≥ 30 `WEBP_LOSSY` calidad 85; API 26–29 `WEBP`).
4. `thumb`: 256 px sobre el fondo de `edit_params.background` (blanco por defecto), WebP.
5. `mask`: canal alfa como PNG en escala de grises.
6. Crear tres `image_renditions` (`tier='device'`), fijar `selected_processed_id` y `selected_thumb_id`.

Si el modelo de segmentación aún no se descargó o falla, se guarda solo el original (el interruptor "Sin fondo" aparece deshabilitado con el texto "Disponible en unos minutos").

## 6. E3 — Mejora en casa, editor e IA

### 6.1 Mejora en casa (T2)

- `POST /v1/images/:id/enhance` → crea `image_jobs` (`remove_bg`) si el original existe; `202 { job_id }`. El cliente pone `enhance_requested_at`.
- El agente procesa (`07-agente.md` §11) y el Worker crea renditions `tier='home'` (escritura de servidor con nueva `version`).
- Adopción automática en el cliente al recibirlas por pull: si `edit_params.manual` no es verdadero, el cliente apunta `selected_*` a la rendition `home` más reciente (edición normal por sync; si dos dispositivos lo hacen, eligen lo mismo).

### 6.2 Editor (RF-IMG-05)

`edit_params`:

```json
{
  "crop": { "x": 0.08, "y": 0.05, "w": 0.84, "h": 0.9 },
  "rotation": 90,
  "background": { "type": "color", "value": "#FFFFFF" },
  "adjust": { "brightness": 0.05, "contrast": 0.1 },
  "manual": true
}
```

Canal de render: original → recorte y rotación → máscara (alfa) → fondo → ajustes → `processed` y `thumb`. El pincel borra o restaura sobre la máscara (tamaño ajustable, deshacer múltiple). Guardar crea renditions `tier='manual'` (máscara, processed, thumb) y fija `manual: true`. "Restablecer" vuelve a la última rendition automática.

### 6.3 Edición generativa (T3, RF-IMG-06)

- `POST /v1/images/:id/ai-edit` `{ prompt?: string, confirm: true }`. Prompt por defecto: "Foto de producto sobre fondo blanco, iluminación de estudio; no cambies el empaque, el texto ni los colores del producto."
- Antes, la UI muestra el costo estimado (`AI_IMAGE_EDIT_EST_COST_USD`) y el gasto del mes.
- Worker: presupuesto → proveedor con URL firmada del original → guarda el resultado como rendition `processed` `tier='ai'` → registra `ai_usage` → `201 { rendition_id, cost_usd }`.
- El cliente genera la miniatura (`tier='manual'`) al adoptarla.

## 7. Pruebas

| Caso | Tipo |
|---|---|
| `parseQuantity` y `suggestVariantLabel` con `fixtures/cantidades.json` (TS y Kotlin) | Unit |
| `signPath` / `verifySigned`: vigente, vencida, firma alterada, ruta distinta; TTL de 10 min vence a los 10 min (sin ventana de 6 h) | Unit |
| PUT: nombre inválido, tipo incorrecto, > 15 MB, fila inexistente, rendition con `tier='home'` desde cliente → rechazados | Worker |
| Lookup: caché positiva y negativa, orden OFF → OBF → OPF, User-Agent enviado | Worker con `fetch` simulado |
| Import: host no permitido → `400 VALIDATION_ERROR` (`HOST_NOT_ALLOWED`); OK → objeto en R2 | Worker |
| `UploadWorker`: espera a que la fila salga del outbox; 409 reintenta; 201 limpia | Android |
| Recorte T1 en 3 fotos reales (botella, caja, bolsa) con fondo de cocina | Manual |
