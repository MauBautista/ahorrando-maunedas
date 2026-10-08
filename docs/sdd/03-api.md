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
| 410 | `ALREADY_BOOTSTRAPPED` | Bootstrap repetido |
| 413 | `PAYLOAD_TOO_LARGE` | > 15 MB en imágenes, > 512 KB en sync |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Tipo de imagen no permitido |
| 422 | `UNSUPPORTED_URL` · `EXTRACTION_FAILED` | Tienda sin adapter · el modelo no devolvió un ticket válido |
| 426 | `UPGRADE_REQUIRED` | Cliente con esquema viejo |
| 429 | `RATE_LIMITED` | Más de 40 extracciones de ticket por usuario al día |
| 500 | `INTERNAL` | Error no previsto |
| 502 | `UPSTREAM_ERROR` | Firebase, Google, Open Food Facts u OpenRouter fallaron |
| 503 | `AI_UNAVAILABLE` | Proveedor de IA caído o sin modelo configurado |

## 2. Estructura del Worker

```
apps/api/src/
├── index.ts                 export default { fetch: app.fetch, scheduled }
├── app.ts                   Hono: middleware (request id, errores, schema), montaje de rutas
├── env.ts                   tipo Env
├── errors.ts                ApiError + onError
├── auth/                    middleware, firebase-admin, proxy, bootstrap
├── google/oauth.ts          token de servicio (FCM + Identity Toolkit)
├── routes/                  me, devices, lookups, products, variants, search, purchases,
│                            barcodes, images, receipts, listings, alerts, admin
├── sync/                    registry, push, pull, upsert (ver 04)
├── agent/                   auth, work, observations, jobs, backup (ver 07)
├── alerts/                  evaluate, deliver, messages (ver 08)
├── fcm/send.ts
├── ai/                      gateway, budget, providers/openrouter, prompts/ (ver 09)
├── receipts/                extract, match, normalize (ver 09)
├── images/                  blobs, signing, import (ver 10)
├── catalog/                 off (Open Food Facts y hermanos); el parser de contenido vive en packages/shared
├── db/                      schema.ts (Drizzle), queries/
├── cron/                    watchdog, maintenance
└── util/                    uuid, time, hash
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
  AI_MONTHLY_BUDGET_USD: string;           // "6"
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
    "AI_MONTHLY_BUDGET_USD": "6",
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
        "AI_MONTHLY_BUDGET_USD": "6",
        "AI_SOFT_LIMIT_PCT": "80"
      }
    }
  }
}
```

Recursos por entorno: D1 `maunedas` / `maunedas-dev`, R2 `maunedas-images` / `maunedas-images-dev` (las pruebas de dev nunca entran en los respaldos de prod) y un proyecto de Firebase por entorno (02 §2).

Un solo Cron (cada hora, minuto 7) ejecuta el watchdog del agente y, a las 04:07 hora de México, el mantenimiento diario (limpieza de `token_cache`, `off_cache` vencido y `image_jobs` viejos).

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
Upsert por `device_id`. Si otro dispositivo tenía el mismo `fcm_token`, se le pone `NULL`.

### `DELETE /v1/devices/:deviceId`
`204`. Solo el dueño del dispositivo.

## 6. Sincronización

`POST /v1/sync/push` y `POST /v1/sync/pull`: contratos completos en `04-sincronizacion.md` §3 y §4.

## 7. Consulta (usada por la web; Android lee de Room)

### `GET /v1/lookups`
```ts
// 200 — solo filas no eliminadas
{ stores: StoreRow[]; store_branches: StoreBranchRow[]; categories: CategoryRow[]; tags: TagRow[] }
```

### `GET /v1/products?q=&category_id=&tag_id=&cursor=&limit=30`
- `q`: se normaliza con `searchKey()`; cada palabra debe aparecer en `products.search_key` (AND). Si `q` son solo dígitos, busca también por código exacto.
- `category_id` incluye subcategorías (CTE recursivo).
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
    image: ImageRef | null;
    latest: Array<{ store_id: Id; source: PriceSource; effective_unit_cents: Cents;
                    display_cents: Cents; observed_at: Millis }>;   // último punto por tienda y fuente
  }>;
}
```

### `GET /v1/products/:id/compare?days=90`
```ts
// 200
{
  display_unit: DisplayUnit;
  rows: Array<{
    variant_id: Id; store_id: Id;
    last: { display_cents: Cents; observed_at: Millis; source: PriceSource };
    min: { display_cents: Cents; observed_at: Millis };
    avg_display_cents: Cents;
    n: number;
  }>;
  best: { variant_id: Id; store_id: Id } | null;    // menor "last" por unidad
}
```

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
Defaults: `to = ahora`, `from = to − 365 días`.

### `GET /v1/search/variants?q=&limit=20`
Para el editor de compra y la revisión de tickets en web.
```ts
// 200
{ items: Array<{ variant_id: Id; product_id: Id; product_name: string; brand: string | null;
                 variant_label: string; barcode_match: boolean; image: ImageRef | null }> }
```

### `GET /v1/purchases?from=&to=&store_id=&status=&cursor=&limit=30`
```ts
// 200 — orden: purchased_at DESC, id DESC
{
  items: Array<{ id: Id; store_id: Id; branch_id: Id | null; purchased_at: Millis; status: 'draft' | 'confirmed';
                 source: string; total_cents: Cents | null; lines_total_cents: Cents; lines: number;
                 receipt_pages: number }>;
  next_cursor: string | null;
}
```

### `GET /v1/purchases/:id`
```ts
// 200
{
  purchase: PurchaseRow;
  items: Array<PurchaseItemRow & { product_id: Id | null; product_name: string | null;
                                   variant_label: string | null; display_unit: DisplayUnit | null;
                                   display_cents: Cents | null }>;
  promotions: PromotionRow[];
  receipt_images: ImageRef[];     // images con owner=purchase y role=receipt, por created_at
}
```

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
Orden de consulta y caché: ver `10-imagenes.md` §2.

## 9. Imágenes

Contratos y flujo completos en `10-imagenes.md`.

| Ruta | Resumen |
|---|---|
| `PUT /v1/images/:imageId/blobs/:name` | Sube binario. `name` ∈ `original.(jpg\|png\|webp)` o `<renditionId>.(webp\|png)`. Requiere que la fila exista (sync previo). `201 { key, bytes }` |
| `GET /v1/images/:imageId/blobs/:name` | Descarga con Bearer **o** con `?exp=&sig=` (URL firmada). `Cache-Control: private, max-age=31536000, immutable` |
| `POST /v1/images/:imageId/import` | `{ source_url }` de un host permitido de Open Food Facts → guarda como original. `201` |
| `POST /v1/images/:imageId/enhance` | (E3) Encola `remove_bg` para el agente. `202 { job_id }` |
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

### `POST /v1/listings/:id/check-now`
`202`. Upsert de `listing_state` (la fila puede no existir aún) con `check_requested_at = now`, en un batch con nueva `version`.

### `GET /v1/listings?variant_id=`
`200 { items: Array<ListingRow & { state: ListingStateRow | null }> }`

### `GET /v1/alerts/events?cursor=&limit=30`
`200 { items: AlertEventRow[]; next_cursor: string | null }` (solo del usuario).

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

### `POST /v1/admin/merge`
```ts
// request
{ kind: 'product' | 'variant'; source_id: Id; target_id: Id }
// 200
{ moved: Record<string, number> }     // filas reasignadas por tabla
```
- `variant`: reasigna `barcodes`, `purchase_items`, `price_observations`, `listings`, `alert_rules`, `receipt_aliases`, `images` (owner) al destino; tombstone del origen.
- `product`: mueve las variantes del origen al producto destino; une etiquetas marcando como borradas las `product_tags` del origen y creando o reviviendo `uuidv5(destino:etiqueta)` (04 §2.1), para no dejar duplicados vivos; tombstone del origen.
- Todas las filas tocadas reciben nueva `version` (un solo batch). `409 E-MERGE_INVALID` si son el mismo, si alguno está eliminado o si en `variant` las medidas difieren (`mass` vs `volume`).

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
