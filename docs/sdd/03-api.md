# 03 · API

Requisitos: todos los `RF-*` con interfaz remota. Sync en detalle: [`04-sincronizacion.md`](./04-sincronizacion.md). Agente: [`07-agente.md`](./07-agente.md).

## 1. Convenciones

| Tema | Regla |
|---|---|
| Base | `https://maunedas.<subdominio>.workers.dev` |
| Versión | Prefijo `/v1`. Cambios incompatibles → `/v2` |
| Formato | JSON UTF-8, claves en `snake_case` (iguales a las columnas de D1) |
| Tiempos | Enteros epoch ms UTC (`*_at`) |
| Dinero | Enteros en centavos (`*_cents`) |
| IDs | UUIDv7 en texto |
| Auth | `Authorization: Bearer <Firebase ID token>` salvo rutas públicas |
| Headers del cliente | `X-Client-Schema: <entero>` y `X-Client-Version: <versión app>` (Android y web) |
| Trazabilidad | El Worker responde `X-Request-Id` (lo genera si no viene) y lo incluye en cada log |
| Paginación | `?cursor=<opaco>&limit=<n>` → `next_cursor: string \| null` |
| Validación | Zod (≥ 4.5) en `packages/shared/src/api/*.ts`, compartido por Worker y web; Android replica los DTOs con kotlinx.serialization |
| Compatibilidad | Si `X-Client-Schema` viene y es < `MIN_CLIENT_SCHEMA` → `426 E-UPGRADE_REQUIRED`. Si no viene (URL firmada en `<img>`, proveedor de IA descargando páginas, proxy de auth, agente) no se valida, salvo en `/v1/sync/*`, donde es obligatorio (`400 E-VALIDATION_ERROR`) |

### 1.1 Formato de error

```json
{
  "error": {
    "code": "BARCODE_TAKEN",
    "message": "Ese código ya pertenece a otra variante.",
    "details": { "variant_id": "0192…" },
    "request_id": "c8d1…"
  }
}
```

`message` está en español y es mostrable al usuario; la UI decide por `code`.

### 1.2 Códigos de error

| HTTP | `code` | Cuándo |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Cuerpo o query inválidos (`details.issues` con las rutas de Zod) |
| 400 | `INVALID_BARCODE` | Código no numérico o fuera de 6–14 dígitos |
| 400 | `WEAK_PASSWORD` · `USERNAME_INVALID` | Alta o cambio de credenciales |
| 401 | `UNAUTHENTICATED` · `INVALID_TOKEN` · `INVALID_SIGNATURE` | Sin token, token inválido, URL firmada inválida o vencida |
| 402 | `AI_BUDGET_EXCEEDED` | Tope mensual de IA alcanzado |
| 403 | `USER_NOT_ALLOWED` · `USER_DISABLED` · `FORBIDDEN` | Ver `02-autenticacion.md` |
| 404 | `NOT_FOUND` | Recurso inexistente o eliminado |
| 409 | `USERNAME_TAKEN` · `GOOGLE_EMAIL_TAKEN` · `LAST_ADMIN` | Administración de usuarios |
| 409 | `IMAGE_NOT_FOUND` · `IMAGE_NOT_UPLOADED` | Subida o uso de imagen antes de sincronizar la fila o el binario |
| 409 | `MERGE_INVALID` · `BATCH_REJECTED` | Fusión imposible · el lote de sync violó una restricción |
| 409 | `CFDI_ALREADY_IMPORTED` | La factura ya es una compra viva (§14); `details.purchase_id` |
| 410 | `ALREADY_BOOTSTRAPPED` | Bootstrap repetido |
| 413 | `PAYLOAD_TOO_LARGE` | > 15 MB en imágenes, > 512 KB en sync |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Tipo de imagen no permitido |
| 422 | `UNSUPPORTED_URL` · `EXTRACTION_FAILED` | Tienda sin adapter · el modelo no devolvió un ticket válido |
| 422 | `UNSUPPORTED_CFDI` | El XML no es una factura de compra importable (§14); `details.reason` |
| 426 | `UPGRADE_REQUIRED` | Cliente con esquema viejo |
| 429 | `RATE_LIMITED` | Más de 40 extracciones de ticket por usuario al día |
| 500 | `INTERNAL` | Error no previsto |
| 502 | `UPSTREAM_ERROR` | Firebase, Google, Open Food Facts u OpenRouter fallaron |
| 503 | `AI_UNAVAILABLE` | Proveedor de IA caído o sin modelo configurado |

## 2. Estructura del Worker

```
apps/api/src/
├── index.ts                 export default { fetch: app.fetch, scheduled }
├── app.ts                   Hono: createApp() con request id → errores → schema → rutas
├── env.ts                   tipo Env y AppEnv (genéricos de Hono)
├── version.ts               API_VERSION y SCHEMA_VERSION (constante hasta T-026)
├── errors.ts                ApiError, mensajes en español por código, onError y notFound
├── middleware/              request-id, client-schema (X-Client-Schema, §1)
├── auth/                    middleware, firebase-admin, proxy, bootstrap
├── google/oauth.ts          token de servicio (FCM + Identity Toolkit)
├── routes/                  health, me, devices, lookups, products, variants, search, purchases,
│                            barcodes, images, receipts, listings, alerts, admin
├── sync/                    registry, push, pull, upsert (ver 04)
├── agent/                   auth, work, observations, jobs, backup (ver 07)
├── alerts/                  evaluate, deliver, messages (ver 08)
├── fcm/send.ts
├── ai/                      gateway, budget, providers/openrouter, prompts/ (ver 09)
├── receipts/                extract, match, normalize (ver 09)
├── images/                  blobs, signing, import (ver 10)
├── catalog/                 off (Open Food Facts y hermanos); el parser de contenido vive en packages/shared
├── db/                      schema.ts (Drizzle, solo consultas tipadas), meta.ts (sync_meta), queries/
├── cron/                    scheduled (despacho del Cron), watchdog, maintenance
└── util/                    log (JSON con request_id), uuid, time, hash
```

```ts
// apps/api/src/env.ts
export interface Env {
  DB: D1Database;
  IMAGES: R2Bucket;
  ASSETS: Fetcher;
  // vars
  FIREBASE_PROJECT_ID: string;
  SYNTHETIC_EMAIL_DOMAIN: string;
  PUBLIC_BASE_URL: string;                 // https://maunedas.<subdominio>.workers.dev
  MIN_CLIENT_SCHEMA: string;               // "1"
  OFF_USER_AGENT: string;                  // "AhorrandoMaunedas/1.0 (uso personal)"
  AI_RECEIPT_PROVIDER: string;
  AI_RECEIPT_MODEL: string;
  AI_RECEIPT_EST_COST_USD: string;         // "0.01" para la verificación previa de presupuesto
  AI_IMAGE_EDIT_PROVIDER: string;
  AI_IMAGE_EDIT_MODEL: string;
  AI_IMAGE_EDIT_EST_COST_USD: string;      // E3
  AI_MONTHLY_BUDGET_USD: string;           // "5"
  AI_SOFT_LIMIT_PCT: string;               // "80"
  // secrets
  GOOGLE_SERVICE_ACCOUNT: string;          // JSON de la cuenta de servicio
  OPENROUTER_API_KEY: string;
  AGENT_TOKEN_SHA256: string;              // hex del sha256 del token del agente
  IMAGE_URL_SECRET: string;                // HMAC para URLs firmadas
  BOOTSTRAP_TOKEN?: string;                // solo hasta crear el primer admin
}
```

```jsonc
// apps/api/wrangler.jsonc
{
  "name": "maunedas",
  "main": "src/index.ts",
  "compatibility_date": "2026-09-30",
  "compatibility_flags": ["nodejs_compat"],
  "workers_dev": true,
  "observability": { "enabled": true },
  "assets": {
    "directory": "../web/dist",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/v1/*", "/agent/*", "/__/auth/*", "/__/firebase/*"]
  },
  "d1_databases": [
    { "binding": "DB", "database_name": "maunedas", "database_id": "<id>", "migrations_dir": "migrations" }
  ],
  "r2_buckets": [{ "binding": "IMAGES", "bucket_name": "maunedas-images" }],
  "triggers": { "crons": ["7 * * * *"] },
  "vars": {
    "FIREBASE_PROJECT_ID": "<proyecto>",
    "SYNTHETIC_EMAIL_DOMAIN": "maunedas.local",
    "PUBLIC_BASE_URL": "https://maunedas.<subdominio>.workers.dev",
    "MIN_CLIENT_SCHEMA": "1",
    "OFF_USER_AGENT": "AhorrandoMaunedas/1.0 (uso personal)",
    "AI_RECEIPT_PROVIDER": "openrouter",
    "AI_RECEIPT_MODEL": "<se define en el spike C>",
    "AI_RECEIPT_EST_COST_USD": "0.01",
    "AI_IMAGE_EDIT_PROVIDER": "openrouter",
    "AI_IMAGE_EDIT_MODEL": "<etapa 3>",
    "AI_IMAGE_EDIT_EST_COST_USD": "0.04",
    "AI_MONTHLY_BUDGET_USD": "5",
    "AI_SOFT_LIMIT_PCT": "80"
  },
  "env": {
    // vars, d1_databases y r2_buckets NO se heredan de la raíz: el entorno dev los repite completos.
    "dev": {
      "name": "maunedas-dev",
      "d1_databases": [ { "binding": "DB", "database_name": "maunedas-dev", "database_id": "<id-dev>", "migrations_dir": "migrations" } ],
      "r2_buckets": [{ "binding": "IMAGES", "bucket_name": "maunedas-images-dev" }],
      "vars": {
        "FIREBASE_PROJECT_ID": "<proyecto-dev>",
        "SYNTHETIC_EMAIL_DOMAIN": "maunedas.local",
        "PUBLIC_BASE_URL": "https://maunedas-dev.<subdominio>.workers.dev",
        "MIN_CLIENT_SCHEMA": "1",
        "OFF_USER_AGENT": "AhorrandoMaunedas/1.0 (uso personal)",
        "AI_RECEIPT_PROVIDER": "openrouter",
        "AI_RECEIPT_MODEL": "<se define en el spike C>",
        "AI_RECEIPT_EST_COST_USD": "0.01",
        "AI_IMAGE_EDIT_PROVIDER": "openrouter",
        "AI_IMAGE_EDIT_MODEL": "<etapa 3>",
        "AI_IMAGE_EDIT_EST_COST_USD": "0.04",
        "AI_MONTHLY_BUDGET_USD": "5",
        "AI_SOFT_LIMIT_PCT": "80"
      }
    }
  }
}
```

Recursos por entorno: D1 `maunedas` / `maunedas-dev`, R2 `maunedas-images` / `maunedas-images-dev` (las pruebas de dev nunca entran en los respaldos de prod) y un proyecto de Firebase por entorno (02 §2).

Un solo Cron (cada hora, minuto 7) ejecuta el watchdog del agente y, a las 04:07 hora de México, el mantenimiento diario (limpieza de `token_cache`, `off_cache` vencido y `image_jobs` viejos).

Mantenimiento (T-041, `cron/maintenance.ts`): la hora se decide con la zona `America/Mexico_City`, no con un desfase fijo. Borra `token_cache` con `expires_at` pasado, `off_cache` fuera de su vigencia (aciertos de más de 30 días y faltas de más de 7, las mismas ventanas de la consulta; la caché vencida que sirve de respaldo ante fallas, T42, dura hasta el siguiente mantenimiento) e `image_jobs` en `done` o `failed` con más de 30 días sin cambios; los `queued` y `claimed` nunca se borran. Solo toca tablas de servidor.

## 3. Tipos comunes

```ts
type Id = string;          // UUIDv7
type Millis = number;
type Cents = number;       // entero
type DisplayUnit = 'kg' | '100g' | 'L' | '100ml' | 'pz';
type PriceSource = 'purchase' | 'shelf' | 'web';

interface ImageRef {
  image_id: Id;
  thumb_url: string | null;        // URL firmada (24 h)
  processed_url: string | null;
  original_url: string | null;
  license: string | null;
  attribution: string | null;
}

interface BestPrice {
  variant_id: Id;
  variant_label: string;
  display_cents: Cents;            // por display_unit del producto
  display_unit: DisplayUnit;
  store_id: Id;
  source: PriceSource;
  observed_at: Millis;
}
```

**Mejor precio** (usado en listas y comparador): para cada combinación (variante, tienda) se toma el punto más reciente de `v_price_points` de los últimos 90 días, sin importar la fuente; el mejor es el de menor `cents_per_base`. Lista y comparador usan exactamente la misma regla.

**Variantes con otra medida:** si la `measure` de una variante no corresponde al `display_unit` del producto (p. ej. una variante a granel en kg dentro de un producto por piezas), sus valores se expresan en la unidad por defecto de su medida (`kg`, `L` o `pz`) y no compiten por "mejor precio".

## 4. Rutas públicas

### `GET /v1/health`
`200 { "ok": true, "version": "1.0.0", "schema_version": 1 }`

### `POST /v1/bootstrap`
Ver `02-autenticacion.md` §5.4.

### `/__/auth/*` y `/__/firebase/*`
Proxy transparente a `https://<proyecto>.firebaseapp.com`. Ver `02-autenticacion.md` §5.5.

## 5. Sesión

### `GET /v1/me`
```ts
// 200
{
  user: { id: Id; username: string; display_name: string; role: 'admin' | 'member'; has_google: boolean };
  server_time: Millis;
  schema_version: number;
  min_client_schema: number;
}
```

### `POST /v1/devices`
```ts
// request
{ device_id: Id; platform: 'android' | 'web'; fcm_token: string | null; app_version: string }
// 204
```
Upsert por `device_id`. Si otro dispositivo tenía el mismo `fcm_token`, se le pone `NULL`. Si el `device_id` era de otro usuario (un teléfono que cambió de manos sin cerrar sesión con red), pasa al usuario que lo registra ahora. Esquema Zod compartido: `packages/shared/src/api/devices.ts` (`device_id` UUID, `fcm_token` ≤ 4096 o `null`, `app_version` ≤ 64, sin campos extra).

### `DELETE /v1/devices/:deviceId`
`204`. Solo el dueño del dispositivo: de otro usuario → `403 E-FORBIDDEN`. Un dispositivo inexistente también responde `204` (cerrar sesión dos veces no es error).

## 6. Sincronización

`POST /v1/sync/push` y `POST /v1/sync/pull`: contratos completos en `04-sincronizacion.md` §3 y §4.

## 7. Consulta (usada por la web; Android lee de Room)

### `GET /v1/lookups`
```ts
// 200 — solo filas no eliminadas
{ stores: StoreRow[]; store_branches: StoreBranchRow[]; categories: CategoryRow[]; tags: TagRow[] }
```

### `GET /v1/products?q=&category_id=&tag_id=&cursor=&limit=30`
- `q`: se normaliza con `searchKey()`; cada palabra debe aparecer en `products.search_key` (AND, coincidencia parcial). Si `q` son de 6 a 14 dígitos, busca también por código exacto.
- `category_id` incluye subcategorías (CTE recursivo).
- `limit` de 1 a 100 (30 por omisión). Orden por `search_key` e `id` (sin acentos ni mayúsculas; equivale a nombre y marca); `next_cursor` es opaco.
- Implementación (T-033): `apps/api/src/routes/{lookups,products,search}.ts`; `best` en `db/queries/prices.ts` (`pickBest`, la misma función que usa el comparador). Las URLs de `ImageRef` son absolutas (`PUBLIC_BASE_URL`) y firmadas por 24 h (10 §3).
```ts
// 200
{
  items: Array<{
    id: Id; name: string; brand: string | null; category_id: Id | null;
    display_unit: DisplayUnit; image: ImageRef | null; variants: number;
    best: BestPrice | null;
  }>;
  next_cursor: string | null;       // orden: name, id
}
```

### `GET /v1/products/:id`
```ts
// 200
{
  product: ProductRow & { tags: TagRow[]; image: ImageRef | null };
  variants: Array<VariantRow & {
    barcodes: string[];
    barcode_rows: Array<{ id: Id; code: string; updated_at: Millis }>;   // para editar por push desde la web (T-161)
    image: ImageRef | null;
    latest: Array<{ store_id: Id; source: PriceSource; effective_unit_cents: Cents;
                    display_cents: Cents; display_unit: DisplayUnit; observed_at: Millis }>;   // último punto por tienda y fuente
  }>;
}
```
Producto inexistente o borrado → `404 E-NOT_FOUND`. `display_unit` de cada punto es la del producto, o la de la medida de la variante si no corresponde (§3).

### `GET /v1/products/:id/compare?days=90`
```ts
// 200
{
  display_unit: DisplayUnit;
  rows: Array<{
    variant_id: Id; store_id: Id;
    display_unit: DisplayUnit;     // la del producto, o la de la medida de la variante si no corresponde (§3)
    last: { display_cents: Cents; observed_at: Millis; source: PriceSource };
    min: { display_cents: Cents; observed_at: Millis };
    avg_display_cents: Cents;
    n: number;
  }>;
  best: { variant_id: Id; store_id: Id } | null;    // menor "last" por unidad
}
```
- Una fila por (variante, tienda) con puntos en los últimos `days` días (1 a 3650; 90 por omisión): `last` es el más reciente, `min` el de menor precio por unidad (en empate, el más reciente) y `avg_display_cents` el promedio de `cents_per_base` de los `n` puntos. Las variantes borradas no aparecen.
- `best` aplica la regla de §3 a los `last` (solo variantes cuya medida corresponde al `display_unit`); con `days = 90` coincide con el `best` de `GET /v1/products`.
- Orden: filas comparables por `last` de menor a mayor; luego las de otra medida. Producto inexistente o borrado → `404`.
- Implementación (T-034): `routes/products.ts` y `comparePrices` en `db/queries/prices.ts`.

### `GET /v1/variants/:id/history?from=&to=&sources=purchase,shelf,web&store_id=`
```ts
// 200
{
  variant: VariantRow & { product_name: string };
  display_unit: DisplayUnit;
  points: Array<{
    source: PriceSource; point_id: Id; store_id: Id; branch_id: Id | null; listing_id: Id | null;
    observed_at: Millis; list_unit_cents: Cents; effective_unit_cents: Cents;
    display_cents: Cents; has_promo: boolean;
  }>;
  web_confirmed_until: Record<Id, Millis>;   // listing_id → listing_state.last_checked_at
}
```
Defaults: `to = ahora`, `from = to − 365 días`. `from > to` → `400`. `sources` es una lista separada por comas de `purchase`, `shelf` y `web` (las tres por omisión). Puntos en orden de `observed_at` (y `point_id`); solo compras confirmadas, con el descuento de ticket prorrateado (`v_price_points`). `web_confirmed_until` incluye los listings vivos de la variante (y de la tienda, si se filtra) con `last_checked_at`. Variante o producto inexistente o borrado → `404`. Implementación (T-034): `routes/variants.ts`.

### `GET /v1/search/variants?q=&limit=20&store_id=`
Para el editor de compra y la revisión de tickets en web. `q` obligatorio; `limit` de 1 a 50. Las palabras se buscan en `search_key` del producto y en la etiqueta de la variante; un código exacto va primero con `barcode_match: true`.
```ts
// 200
{ items: Array<{ variant_id: Id; product_id: Id; product_name: string; brand: string | null;
                 variant_label: string; barcode_match: boolean; image: ImageRef | null;
                 measure: Measure; unit_amount: number; pack_count: number; sold_by_weight: boolean;
                 display_unit: DisplayUnit; last_unit_cents: Cents | null }> }
```
- `measure`, `unit_amount`, `pack_count`, `sold_by_weight` y `display_unit` (§3) son lo que una línea de compra necesita para calcular y mostrar (S-05, T-162).
- Con `store_id`, `last_unit_cents` es el precio de lista del punto más nuevo de `v_price_points` de esa variante en esa tienda (cualquier fuente), igual que "Último aquí" en Android. Sin `store_id` o sin precio ahí, `null`.

### `GET /v1/purchases?from=&to=&store_id=&status=&cursor=&limit=30`
```ts
// 200 — orden: purchased_at DESC, id DESC
{
  items: Array<{ id: Id; store_id: Id; branch_id: Id | null; purchased_at: Millis; status: 'draft' | 'confirmed';
                 source: string; total_cents: Cents | null; discount_cents: Cents; lines_total_cents: Cents; lines: number;
                 receipt_pages: number }>;
  next_cursor: string | null;
}
```
- `from`/`to` filtran `purchased_at` (inclusivos; `from > to` → `400`); `limit` de 1 a 100. Solo compras vivas; las compras son del hogar, no de cada usuario.
- `lines_total_cents` es la suma de `final_cents` de las líneas vivas, antes del descuento de ticket (para compararla con `total_cents`); `receipt_pages` cuenta las imágenes vivas `owner=purchase, role=receipt`.
- `next_cursor` es opaco (`purchased_at`, `id`), así que dos compras a la misma hora no se repiten ni se saltan. Implementación (T-035): `routes/purchases.ts`.

### `GET /v1/purchases/:id`
```ts
// 200
{
  purchase: PurchaseRow;
  items: Array<PurchaseItemRow & { product_id: Id | null; product_name: string | null; brand: string | null;
                                   variant_label: string | null; measure: Measure | null; unit_amount: number | null;
                                   pack_count: number | null; sold_by_weight: boolean | null;
                                   display_unit: DisplayUnit | null; display_cents: Cents | null }>;
  promotions: PromotionRow[];
  receipt_images: ImageRef[];     // images con owner=purchase y role=receipt, por created_at
}
```
- Solo líneas vivas, por `line_no`. `display_cents` es lo pagado por unidad de despliegue con el descuento de ticket prorrateado (`prorateTicketDiscount`, igual que `v_price_points`), también en borradores; `display_unit` sigue §3. Líneas sin vincular → campos del producto y de la variante en `null`. `measure`, `unit_amount`, `pack_count` y `sold_by_weight` son los de la variante, para que el editor web recalcule la línea (T-162).
- `promotions`: las de la compra y las de sus líneas vivas. Compra inexistente o borrada → `404`.

## 8. Códigos de barras

### `GET /v1/barcodes/:code`
```ts
// 200
{
  code: string;                                // normalizado: solo dígitos
  match: { variant_id: Id; product_id: Id; product_name: string; variant_label: string } | null;
  catalog: null | {                            // solo si match = null
    source: 'off' | 'obf' | 'opf';
    name: string | null; brand: string | null;
    quantity_text: string | null;              // "6 x 1 l"
    parsed: { measure: 'mass' | 'volume' | 'count'; unit_amount: number; pack_count: number } | null;
    image_url: string | null;
    license: string; attribution: string; source_url: string;
  };
}
```
Orden de consulta, caché y fallas de los catálogos: ver `10-imagenes.md` §2.1. `match` exige código, variante y producto vivos.

## 9. Imágenes

Contratos y flujo completos en `10-imagenes.md`.

| Ruta | Resumen |
|---|---|
| `PUT /v1/images/:imageId/blobs/:name` | Sube binario. `name` ∈ `original.(jpg\|png\|webp)` o `<renditionId>.(webp\|png)`. Requiere que la fila exista (sync previo). `201 { key, bytes }` |
| `GET /v1/images/:imageId/blobs/:name` | Descarga con Bearer **o** con `?exp=&sig=` (URL firmada). `Cache-Control: private, max-age=31536000, immutable` |
| `POST /v1/images/:imageId/import` | `{ source_url }` de un host permitido de Open Food Facts → guarda como original. `201` |
| `POST /v1/images/:imageId/enhance` | (E3) Encola `remove_bg` para el agente. `202 { job_id }`; el mismo si ya espera uno. Solo fotos de catálogo con el original en R2 (`404` · `409 E-IMAGE_NOT_UPLOADED`). 10 §6.1 |
| `POST /v1/images/:imageId/ai-edit` | (E3) `{ prompt, confirm: true }`. Consume presupuesto |

## 10. Tickets

### `POST /v1/receipts/extract`
```ts
// request
{ image_ids: Id[] /* 1..4, en orden de página */; purchase_id?: Id; store_id?: Id; force?: boolean }
```
Respuesta, errores y algoritmo: `09-ia-y-tickets.md` §4.

## 11. Tracking y alertas (E2)

### `POST /v1/listings/resolve`
```ts
// request
{ url: string }         // puede venir con texto alrededor (se extrae la primera URL)
// 200
{ adapter: string; store_id: Id; url: string; canonical_url: string; external_id: string | null }
// 422 E-UNSUPPORTED_URL
```
Resuelve enlaces cortos (`amzn.to`, `a.co`) siguiendo redirecciones con `redirect: 'manual'` (solo se leen los `Location`, sin descargar la página). No crea el listing: el cliente lo crea por sync.

**Implementación (T-210, decisión T83):**
- **Reglas:** adapter, URL canónica e id salen de `packages/shared/src/tracking/urls.ts` (`canonicalListing`), con los vectores de `fixtures/enlaces.json` que también usará el agente. La canónica quita consulta y fragmento y siempre usa `https://www.`.
- **Enlaces cortos:** hasta 5 saltos, de 5 s cada uno. Un `Location` sin esquema se toma respecto al enlace anterior.
- **Tienda:** la tienda viva con ese `adapter` (las semillas las crean en cada entorno).
- **`url`:** la primera URL del texto, tal como se compartió (es la que guarda `listings.url`).
- **Rechazo:** `details.reason` dice por qué: `NO_URL` (no hay URL), `SHORT_LINK` (el enlace corto no lleva a una página), `NOT_TRACKED` (tienda sin adapter, como Walmart por T34, o no es la página de un producto) o `NO_STORE` (falta la tienda).
- **`check-now`:** responde `404` para un listing borrado o inexistente.
- **`GET /v1/listings`:** devuelve los listings vivos de la variante, activos o no, con `state: null` si aún no tienen estado.

### `POST /v1/listings/:id/check-now`
`202`. Upsert de `listing_state` (la fila puede no existir aún) con `check_requested_at = now`, en un batch con nueva `version`.

### `GET /v1/listings?variant_id=`
`200 { items: Array<ListingRow & { state: ListingStateRow | null }> }`

### `GET /v1/alerts/events?cursor=&limit=30`
`200 { items: AlertEventRow[]; next_cursor: string | null }` (solo del usuario).

### `GET /v1/alerts/rules?variant_id=` (T-223)
`200 { items: Array<AlertRuleRow & { product_id, product_name, brand, variant_label, store_name: string | null }> }`. Solo las reglas vivas del usuario; `variant_id` es opcional. Android las tiene por sync; la web no guarda copia local.

**Ampliaciones para la web (T-223, decisión T92):**
- **`GET /v1/listings`:** `variant_id` es **opcional**. Sin él devuelve todos los listings vivos (W-20), ordenados por producto, presentación y tienda. Cada uno trae `product_id`, `product_name`, `brand`, `variant_label`, `store_name` y `store_interval_min` (el `default_check_interval_min` de su tienda, T-224).
- **`GET /v1/alerts/events`:** cada alerta trae `variant_id`, `product_id`, `product_name`, `brand` y `variant_label` (de su regla), o `null` si la regla o la presentación ya no existen, para enlazarla a la ficha.

## 12. Administración (rol admin)

### `GET /v1/admin/users`
```ts
{ items: Array<{ id: Id; username: string; display_name: string; role: 'admin' | 'member'; active: boolean;
                 google_email: string | null; has_password: boolean; created_at: Millis }> }
```

### `POST /v1/admin/users`
```ts
// request — al menos uno de password o google_email
{ username: string; display_name: string; role: 'admin' | 'member'; password?: string; google_email?: string }
// 201 { user }
```

### `PATCH /v1/admin/users/:id`
```ts
{ display_name?: string; role?: 'admin' | 'member'; active?: boolean; google_email?: string | null }
// 200 { user } · 409 E-LAST_ADMIN si deja al sistema sin admin activo · 409 E-GOOGLE_EMAIL_TAKEN
```
Cambiar o quitar `google_email` borra las identidades `google.com` del usuario (02 §5.3).

### `POST /v1/admin/users/:id/password`
`{ password: string }` → `204`

Común a `/v1/admin/users*`: solo admin (`403 E-FORBIDDEN`); usuario inexistente → `404`; `username` se normaliza (`normalizeUsername`) y debe cumplir `USERNAME_RE` (`400 E-USERNAME_INVALID`); contraseña de menos de 8 caracteres → `400 E-WEAK_PASSWORD`, antes de llamar a Firebase; un `PATCH` sin campos → `400`. Respuesta `user` con la misma forma que los elementos de la lista. Implementación (T-023): `routes/admin.ts` y `auth/users.ts`.

### `POST /v1/admin/merge`
```ts
// request
{ kind: 'product' | 'variant'; source_id: Id; target_id: Id; dry_run?: boolean }
// 200
{ moved: Record<string, number> }     // filas reasignadas por tabla
```
- `dry_run: true` es la vista previa de W-12 (T-165): hace las mismas revisiones (y responde los mismos errores), cuenta las filas que se moverían con las mismas condiciones del `UPDATE` y no escribe nada.
- `variant`: reasigna `barcodes`, `purchase_items`, `price_observations`, `listings`, `alert_rules`, `receipt_aliases`, `images` (owner) al destino; tombstone del origen.
- `product`: mueve las variantes del origen al producto destino; une etiquetas marcando como borradas las `product_tags` del origen y creando o reviviendo `uuidv5(destino:etiqueta)` (04 §2.1), para no dejar duplicados vivos; tombstone del origen.
- Todas las filas tocadas reciben nueva `version` (un solo batch). `409 E-MERGE_INVALID` si son el mismo, si alguno está eliminado o si en `variant` las medidas difieren (`mass` vs `volume`); `details.reason` = `SAME`, `DELETED` o `MEASURE_MISMATCH`. Un id que no existe en la tabla de `kind` → `404 E-NOT_FOUND`. Solo admin (`403 E-FORBIDDEN`).
- Se mueven también las filas ya borradas que apuntan al origen, para que nada quede ligado a él. El destino recibe las imágenes del origen (`images.owner_id`) y, si no tenía, su `primary_image_id` (decisión T44).
- Al fusionar variantes, los precios por unidad de las compras y observaciones movidas se recalculan con el contenido del destino (`v_price_points`): fusionar solo presentaciones iguales.
- `moved` incluye todas las tablas con su conteo (también 0): `variant` → las 6 tablas con `variant_id` e `images`; `product` → `variants`, `images` y `product_tags` (ligas del origen unidas al destino). Implementación (T-038): `routes/admin.ts` y `db/queries/merge.ts`; una prueba compara la lista con las llaves foráneas de D1.

### `GET /v1/admin/ai-budget`
```ts
{ month: string /* '2026-09' */; budget_usd: number; spent_usd: number; soft_limit_pct: number;
  soft_limit_reached: boolean;     // banner en W-13 (09 §2)
  by_purpose: Record<'receipt' | 'image_edit' | 'other', number>; calls: number }
```

### `GET /v1/admin/agent` (E2)
```ts
{ status: AgentStatusRow | null; online: boolean /* heartbeat < 3 min */; blocked_listings: number;
  failing_listings: number; queued_image_jobs: number }
```
- Solo admin. `status` es la fila con el latido más reciente, con `info` ya como objeto.
- `blocked_listings` cuenta los listings vivos con `last_status = 'blocked'`, y `failing_listings` los vivos con `consecutive_failures > 0`. Implementación (T-214): `routes/admin.ts`.

### Tokens de Home Assistant (T-308)

- **`GET /v1/admin/ha-tokens`:** `200 { items: Array<{ id; name; created_by_name; created_at; last_used_at: Millis | null; revoked_at: Millis | null }> }`. Primero los vivos, luego los revocados; dentro, del más nuevo al más viejo.
- **`POST /v1/admin/ha-tokens`:** `{ name: string /* 1–60, se recorta */ }` → `201`, la misma fila más `token`.
  - El token es `mha_` más 32 bytes aleatorios en base64url.
  - Solo se muestra aquí: el Worker guarda su SHA-256 en `ha_tokens`, nunca el token.
- **`DELETE /v1/admin/ha-tokens/:id`:** `204`. Pone `revoked_at` una sola vez (repetirlo no cambia la fecha). La fila queda para saber quién la creó y cuándo se usó. Id inexistente → `404`.
- Solo admin (`403 E-FORBIDDEN`). Implementación: `routes/admin.ts`.

## 13. Home Assistant (E3, T-308, decisión T103)

API de solo lectura bajo `/ha/v1/*`, con `Authorization: Bearer <token de Home Assistant>`.
- **Autenticación (`ha/auth.ts`):** el token se busca por su SHA-256 entre los no revocados. Sin token, desconocido o revocado → `401 E-UNAUTHENTICATED`.
- **Alcance:** el token no abre `/v1` (que pide una sesión de usuario) y una sesión no abre `/ha/v1`. Solo hay `GET`.
- **Último uso:** `last_used_at` se anota a lo más una vez por hora y por token, en `waitUntil`.
- **Enrutamiento:** `/ha/*` está en `run_worker_first`, junto a `/v1/*` y `/agent/*`.

### `GET /ha/v1/variants`
`200 { items: Array<{ variant_id: Id; name: string /* "Producto · Presentación" */ }> }`. Todas las presentaciones vivas, por producto y presentación, para encontrar su id.

### `GET /ha/v1/variants/:id`
```ts
// 200
{
  variant_id: Id;
  name: string;                       // "Leche Lala Entera · 1 L"
  display_unit: DisplayUnit;          // la del producto, o la de la medida de la variante (§3)
  current: HaPrice | null;            // regla de mejor precio (§3) sobre el último punto de cada tienda en 90 días
  lowest: HaPrice | null;             // el menor precio por unidad de todos los puntos (en empate, el más reciente)
  in_stock: boolean | null;           // algún listing activo con existencia; null si ninguno se ha revisado
  listings: Array<{ store: string; price_cents: Cents | null; in_stock: boolean | null;
                    status: ListingStatus | null; checked_at: Millis | null }>;   // solo los activos y vivos
}
// HaPrice
{ price_cents: Cents /* effective_unit_cents */; display_cents: Cents; store: string; source: PriceSource; observed_at: Millis }
```
Id que no es UUID → `400`; presentación inexistente o borrada (o de un producto borrado) → `404 E-NOT_FOUND`. Implementación: `routes/ha.ts` y `ha/variant.ts`, con `POINTS_SQL`, `pickBest` y `unitFor` de `db/queries/prices.ts`.

## 14. Importación de CFDI (E3, T-307, decisión T104)

El Worker lee el XML de una factura electrónica (CFDI 3.3 o 4.0, timbrada, de ingreso y en pesos) y la vuelve una compra en borrador (`source='cfdi'`) que se revisa y confirma como cualquier otra. El XML no se guarda.

### `POST /v1/purchases/cfdi/preview`
`{ xml: string /* ≤ 2 MB */ }` → `200 CfdiPreviewResponse` (`packages/shared/src/api/cfdi.ts`), sin escribir nada:
```ts
{ fiscal_uuid: string /* mayúsculas */; issued_at: Millis; emisor: { rfc: string; name: string | null };
  total_cents: Cents; lines: CfdiLine[]; linked: number;
  store_id: Id | null;              // tienda sugerida
  imported_purchase_id: Id | null } // la compra viva que ya es esta factura
// CfdiLine
{ line_no; description; quantity: number; unit_price_cents; gross_cents; discount_cents; final_cents;
  sku: string | null /* NoIdentificacion */; variant_id: Id | null /* por alias de la tienda sugerida */ }
```
- **Líneas, como se pagaron:**
  - `final = Importe − Descuento + traslados − retenciones` del concepto.
  - El descuento lleva la misma tasa: `Descuento × (1 + impuestos / base)`, así `gross − discount = final` al centavo.
  - `unit_price_cents = gross / cantidad`.
  - El dinero se cuenta en millonésimas con `BigInt`, nunca en flotantes (regla 1).
- **Fecha:** `Fecha` no trae zona; se toma como hora de la Ciudad de México.
- **Tienda sugerida:**
  - si el RFC del emisor ya se importó, y siempre a la misma tienda viva, esa;
  - si se importó a varias tiendas, ninguna. Nueva Wal-Mart de México factura Walmart, Bodega Aurrera y Sam's con un RFC.
  - un RFC nuevo se busca por el nombre del emisor (`matchStoreName`, que ignora esa razón social).
- **Rechazos (`422 E-UNSUPPORTED_CFDI`, `details.reason`):**
  - `NOT_XML`: no es XML, o trae `<!DOCTYPE`/`<!ENTITY`, que una factura nunca trae;
  - `NOT_CFDI`: no es un Comprobante 3.3/4.0, o le falta el emisor, la fecha, el total o una cantidad válida;
  - `NOT_INCOME`: tipo distinto de `I`, como notas de crédito o pagos;
  - `NOT_MXN`;
  - `NO_UUID`: sin timbre fiscal;
  - `NO_LINES`;
  - `TOO_MANY_LINES`: más de 300.

### `POST /v1/purchases/cfdi`
`{ xml: string; store_id: Id }` → `201 { purchase_id: Id; lines: number; linked: number }`.
- **Escritura:** en un batch y con una sola versión nueva, como la fusión de §12. Crea:
  - la compra (`status='draft'`, `purchased_at`, `total_cents = Total`, `subtotal_cents = Σ gross`, `discount_cents = 0`, `notes = "Factura {UUID} de {emisor}"`);
  - sus líneas, con `raw_text` = descripción y el `variant_id` de los alias de esa tienda (09 §5.1);
  - la fila `cfdi_imports`.
  
  Los clientes la reciben por pull.
- **Errores:**
  - tienda inexistente o borrada → `404`;
  - factura que ya es una compra viva → `409 E-CFDI_ALREADY_IMPORTED` con `details.purchase_id`.
- **Reimportar:** una compra borrada deja importarla de nuevo.
- **`cfdi_imports`:** tabla de servidor, solo se agrega y no se sincroniza. Guarda el UUID fiscal, la compra, la tienda, el RFC y el nombre del emisor, quién y cuándo. Va en el respaldo (07 §5.4).
- **Implementación:** `cfdi/parse.ts` (con `fast-xml-parser`), `cfdi/import.ts` y `routes/purchases.ts`.

