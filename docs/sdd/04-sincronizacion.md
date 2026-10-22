# 04 · Sincronización

Requisitos: RF-SYN-01 a RF-SYN-04, RNF-01, RNF-02. Reglas generales en `ARQUITECTURA.md` §4.1; este documento es la especificación implementable.

## 1. Modelo

- **Clientes**: Android (Room, offline) y web (sin almacenamiento local; escribe con push y lee con endpoints de consulta).
- **Unidad de conflicto**: la fila. Gana el `updated_at` mayor (LWW). Empate: gana lo que ya está en el servidor.
- **Versión**: contador global `sync_meta.version`, se incrementa una vez por push aceptado; todas las filas escritas en ese push reciben ese valor.
- **Tipos de tabla**: `sync` (ambos sentidos), `down` (solo servidor → cliente), `server` (no viaja).

## 2. Registro de tablas

`packages/shared/src/sync/registry.ts` es la fuente única; el Worker y Android (generado o copiado a `core/sync/SyncTables.kt`) lo usan igual.

| Tabla | Modo | Orden | Alcance | Reglas especiales |
|---|---|---:|---|---|
| `users` | down | 5 | hogar | Solo viajan `id, username, display_name, role, active, updated_at, version` |
| `agent_status` | down | 5 | hogar | — |
| `stores` | sync | 10 | hogar | Borrado solo admin |
| `categories` | sync | 10 | hogar | Borrado solo admin; `parent_id` puede apuntar a la misma tabla |
| `tags` | sync | 10 | hogar | — |
| `store_branches` | sync | 20 | hogar | — |
| `products` | sync | 20 | hogar | Borrado solo admin; `search_key` derivada (el servidor la recalcula) |
| `variants` | sync | 30 | hogar | Borrado solo admin; misma `measure` no se puede cambiar si ya hay compras (el servidor lo rechaza con `VALIDATION`) |
| `product_tags` | sync | 30 | hogar | id UUIDv5 determinista |
| `barcodes` | sync | 40 | hogar | Único parcial por `code` → `BARCODE_TAKEN` |
| `images` | sync | 40 | hogar | `original_key` debe ser `images/{id}/original.{ext}` |
| `listings` | sync | 40 | hogar | `adapter` debe existir en la lista de adapters |
| `purchases` | sync | 40 | hogar | — |
| `listing_state` | down | 45 | hogar | pk `listing_id` |
| `image_renditions` | sync | 50 | hogar | Append-only: una fila existente solo acepta cambio de `deleted_at`. Clientes solo crean `tier ∈ {device, manual}`; `r2_key = images/{image_id}/{id}.{webp\|png}` |
| `purchase_items` | sync | 50 | hogar | `final_cents = gross_cents − discount_cents`, `quantity > 0` |
| `receipt_aliases` | sync | 50 | hogar | id UUIDv5; único parcial `(store_id, raw_text_norm)` → `ALIAS_TAKEN` |
| `price_observations` | sync | 50 | hogar | Clientes solo crean o editan filas `source='shelf'`; las `web` son del servidor |
| `alert_rules` | sync | 50 | **usuario** | `user_id` = usuario autenticado, en alta y en edición |
| `alert_events` | down | 55 | **usuario** | — |
| `promotions` | sync | 60 | hogar | Exactamente un dueño (compra, línea u observación) |

```ts
// packages/shared/src/sync/registry.ts (extracto)
export type SyncMode = 'sync' | 'down';

export interface TableSpec {
  mode: SyncMode;
  order: number;
  pk: string;                                   // 'id' salvo listing_state
  columns: readonly string[];                   // columnas que viajan en pull
  writable?: readonly string[];                 // columnas aceptadas en push (sin version)
  scope: 'household' | 'user';
  adminDelete?: boolean;
  appendOnly?: boolean;
  uniqueLive?: readonly string[];               // índice único parcial (deleted_at IS NULL)
  derive?: (row: Row) => Row;                   // columnas derivadas (p. ej. search_key)
}

const SYNC_COLS = ['created_at', 'updated_at', 'deleted_at', 'updated_by'] as const;

export const TABLES = {
  products: {
    mode: 'sync', order: 20, pk: 'id', scope: 'household', adminDelete: true,
    writable: ['id', 'name', 'brand', 'category_id', 'display_unit', 'notes', 'primary_image_id', 'search_key', ...SYNC_COLS],
    columns: ['id', 'name', 'brand', 'category_id', 'display_unit', 'notes', 'primary_image_id', 'search_key', ...SYNC_COLS, 'version'],
    derive: (r) => ({ ...r, search_key: searchKey(`${r.name} ${r.brand ?? ''}`) }),
  },
  barcodes: {
    mode: 'sync', order: 40, pk: 'id', scope: 'household', uniqueLive: ['code'],
    writable: ['id', 'variant_id', 'code', 'format', 'source', ...SYNC_COLS],
    columns: ['id', 'variant_id', 'code', 'format', 'source', ...SYNC_COLS, 'version'],
  },
  // … resto de tablas según esquema-d1.sql
} as const satisfies Record<string, TableSpec>;
```

Cada tabla tiene además un esquema Zod de fila (`packages/shared/src/sync/rows.ts`) con tipos, enums, longitudes máximas (`name` ≤ 200, `notes` ≤ 2000, `raw_text` ≤ 300) y las reglas de la columna "Reglas especiales".

### 2.1 Identificadores y claves deterministas

Dos dispositivos sin red deben generar el mismo id para la misma relación. Implementación en `packages/shared/src/util/uuid.ts` y `core:model` (Kotlin); vectores en `fixtures/ids.json`.

| Tabla | `id` | Nombre (UTF-8) |
|---|---|---|
| `product_tags` | `uuidv5(nombre, NS_PRODUCT_TAGS)` | `product_id + ':' + tag_id` |
| `receipt_aliases` | `uuidv5(nombre, NS_RECEIPT_ALIASES)` | `store_id + ':' + raw_text_norm` |

Namespaces fijos (no cambian nunca; cambiarlos cambiaría todos los ids):

| Constante | Valor |
|---|---|
| `NS_PRODUCT_TAGS` | `2bbba539-5872-4d57-8ff4-222c52764194` |
| `NS_RECEIPT_ALIASES` | `1258c7ae-83bc-44c3-be9d-5e4ce482dbb8` |

`products.search_key = searchKey(name + ' ' + (brand ?? ''))`, donde `searchKey`: descomponer (NFKD), quitar marcas diacríticas, pasar a minúsculas, reemplazar cada tramo de caracteres fuera de `a-z0-9` por un espacio y recortar. Casos en `fixtures/textos.json` (`search_key`).

### 2.2 Esquemas de fila (T-030)

`packages/shared/src/sync/rows.ts` tiene un esquema Zod por tabla (`ROW_SCHEMAS`): para tablas `sync`, la fila de push con exactamente las columnas `writable`; para tablas `down`, la fila que baja. `apps/api/test/registry.test.ts` compara el registro y los esquemas contra el `PRAGMA` de D1 (tablas con `version`, columnas, llave primaria, índices únicos parciales y que cada llave foránea apunte a una tabla de orden menor).

Regla de compatibilidad (§3.3): son obligatorias las columnas `NOT NULL` sin valor por defecto; las que tienen default o aceptan `NULL` son opcionales (ausente = no tocar; `null` = poner `NULL`). Toda columna nueva se agrega como opcional. Excepción: las columnas que intervienen en una regla entre campos viajan siempre (`gross_cents`, `discount_cents`, `final_cents`; los tres dueños de `promotions`).

Validaciones además de las de la tabla anterior: nombres recortados de 1 a 200 caracteres (`tags.name` ≤ 100, `variants.label` ≤ 100), `notes` ≤ 2000, `raw_text` ≤ 300; ids UUID; tiempos y centavos enteros ≥ 0; booleanos `0`/`1`; código de barras de 6 a 14 dígitos; URLs `http(s)` ≤ 2048; columnas JSON válidas (`params` ≤ 2000, `extra` y `edit_params` ≤ 4000); intervalo de revisión de 60 a 10,080 min (1 h a 7 días, regla 10); `adapter` ∈ `ADAPTERS` (`packages/shared/src/tracking/adapters.ts`: `amazon_mx`, `costco_mx`, `sams_mx`); a granel solo con `measure='mass'`, `unit_amount=1000` y `pack_count=1`; una categoría no es su propia madre; `below_price` exige `threshold_cents` y `drop_pct` exige `threshold_pct` (0 < x ≤ 100); `product_tags.id` y `receipt_aliases.id` se verifican contra su UUIDv5 (§2.1) y `raw_text_norm` debe estar ya normalizado.

## 3. Push

### 3.1 Contrato

```ts
// POST /v1/sync/push — body ≤ 512 KB
{
  device_id: Id;
  mutations: Array<{ table: string; row: Record<string, unknown> }>;   // 1..100
}

// 200
{
  applied: number;                    // filas escritas
  skipped: number;                    // filas no escritas (conflictos)
  conflicts: Array<{
    table: string;
    id: string;
    reason: 'STALE' | 'BARCODE_TAKEN' | 'ALIAS_TAKEN' | 'VALIDATION' | 'FORBIDDEN' | 'IMMUTABLE_ROW' | 'UNKNOWN_TABLE';
    server_row: Record<string, unknown> | null;   // estado actual en el servidor, si existe
    details?: unknown;                            // issues de Zod, variante dueña del código, etc.
  }>;
}

// 409 E-BATCH_REJECTED — D1 rechazó el lote pese a las verificaciones previas (carrera en un índice único u
//                         otra restricción inesperada). Nada se escribió.
```

Un push con conflictos **no es error**: responde 200 y aplica el resto.

### 3.2 Algoritmo (Worker)

Implementación: `apps/api/src/sync/push.ts` (T-031). El orden real de los pasos 3 a 5 cambió respecto a v1.1 para validar la fila completa:

1. **Autenticar** y validar tamaño (≤ 100 mutaciones, ≤ 512 KB) → `413`/`400`.
2. **Clasificar**: tabla desconocida o `mode='down'` → conflicto `UNKNOWN_TABLE`.
3. **Sanear cada fila**: quedarse con `writable`; el `id` debe ser UUID y `updated_at` debe venir (si no → `VALIDATION`); forzar `updated_by = user.id` (y `user_id = user.id` en tablas de alcance usuario); `updated_at = min(updated_at, now + 5 min)`. La misma fila dos veces en un push: gana la última; las anteriores → `VALIDATION` (`details.reason = 'DUPLICATE_IN_BATCH'`).
4. **Validar** la fila **combinada** (columnas `writable` del existente + las que llegan) con el Zod de la tabla → `VALIDATION` (con `details.issues`). `derive` también usa la fila combinada: un cliente que no manda `brand` no la borra de `search_key`. Se escriben los valores normalizados por Zod (p. ej. nombres recortados).
5. **Leer existentes** (antes del paso 4): por tabla, un `SELECT … WHERE pk IN (SELECT value FROM json_each(?1))` con los ids del lote como un solo parámetro JSON (D1 admite 100 parámetros por consulta y, en Free, 50 consultas por invocación: ver spike D).
6. **Reglas con existente**, en este orden:
   - **Reintento idéntico**: existe, `existing.updated_at == incoming.updated_at` y `existing.updated_by == user.id` → se cuenta como aplicado, sin conflicto (la respuesta anterior se perdió después del commit).
   - `STALE`: existe y `existing.updated_at > incoming.updated_at`, o es igual pero de otro autor → no se escribe; `server_row = existing`.
   - `IMMUTABLE_ROW`: `appendOnly` y cambia algo distinto de `deleted_at`.
   - `FORBIDDEN`: tombstone nuevo en tabla `adminDelete` por un miembro (`details.reason = 'ADMIN_DELETE'`); `alert_rules` ajena (`NOT_OWNER`); `price_observations` con `source != 'shelf'` o que modifica una fila `web` (`WEB_OBSERVATION`); rendition nueva con `tier` fuera de `device`/`manual` (`RENDITION_TIER`). Restaurar un registro borrado no es un borrado.
   - `VALIDATION` con `details.reason = 'MEASURE_LOCKED'`: cambio de `measure` de una variante que ya tiene líneas de compra vivas.
7. **Únicos**: para tablas con `uniqueLive`, consultar filas vivas con esos valores y otro `id` → `BARCODE_TAKEN` (`details.variant_id`) o `ALIAS_TAKEN` (`server_row` = alias existente). No es conflicto si la otra fila se borra o cambia de valor en el mismo push (mover un código); entre filas del mismo push gana la primera.
   - **Padres** (`refs` del registro, igual a las llaves foráneas de D1): cada referencia no nula debe existir en D1 (viva o borrada) o aceptarse en el mismo push; si no → `VALIDATION` (`details = { reason: 'MISSING_PARENT', column, table }`) solo para esa fila, y en cascada para sus hijos del mismo push. Así el lote no falla entero por un padre faltante (además, el D1 local no reporta como restricción una llave foránea diferida violada al confirmar).
8. **Construir el lote** con las filas aceptadas, ordenadas por `order`:
   ```
   PRAGMA defer_foreign_keys = on
   UPDATE sync_meta SET value = value + 1 WHERE key = 'version'
   <upserts>
   ```
9. **Ejecutar** `DB.batch()`. Si falla por restricción → `409 E-BATCH_REJECTED` con el mensaje de D1 en `details`.
10. **Efectos diferidos** (`ctx.waitUntil`): ninguno en E1. (En E2 las observaciones `shelf` no disparan alertas.)
11. Responder. `applied` cuenta las filas escritas más los reintentos idénticos; `skipped`, los conflictos.

### 3.3 Upsert dinámico

Solo se actualizan las columnas presentes en la mutación. Así un cliente con esquema anterior no borra columnas nuevas que no conoce.

```ts
// apps/api/src/sync/upsert.ts
export function buildUpsert(db: D1Database, table: string, spec: TableSpec, row: Row): D1PreparedStatement {
  const cols = spec.writable!.filter((c) => c in row);   // nombres vienen de la lista blanca → sin inyección
  const insertCols = [...cols, 'version'];
  const values = cols.map((_, i) => `?${i + 1}`);
  const updates = cols
    .filter((c) => c !== spec.pk && c !== 'created_at')
    .map((c) => `${c} = excluded.${c}`)
    .concat('version = excluded.version');

  const sql =
    `INSERT INTO ${table} (${insertCols.join(', ')}) ` +
    `VALUES (${values.join(', ')}, (SELECT value FROM sync_meta WHERE key = 'version')) ` +
    `ON CONFLICT(${spec.pk}) DO UPDATE SET ${updates.join(', ')} ` +
    `WHERE excluded.updated_at > ${table}.updated_at`;

  return db.prepare(sql).bind(...cols.map((c) => row[c] ?? null));
}
```

### 3.4 Escrituras del servidor en tablas `sync`

Algunas operaciones del servidor escriben filas de tablas `sync` (fusión de admin, observaciones web del agente, renditions `home`/`catalog`/`ai`). Siempre:

- en un batch que empieza con `UPDATE sync_meta …`,
- con `updated_at = now`, `updated_by = <usuario admin | 'agent'>`,
- con `version` = el nuevo valor.

Para el cliente son ediciones normales que llegan por pull.

## 4. Pull

### 4.1 Contrato

```ts
// POST /v1/sync/pull
{
  cursors: Record<string, [number, string]>;   // tabla → [version, id]; ausente = [0, ""]
  limit?: number;                              // por tabla, 1..500, default 100 (spike D: CPU en plan Free)
  tables?: string[];                           // default: todas las sync + down
}

// 200
{
  changes: Record<string, Row[]>;              // solo tablas con filas
  cursors: Record<string, [number, string]>;   // nuevo cursor por tabla consultada
  has_more: boolean;                           // alguna tabla devolvió `limit` filas
  server_time: number;
  schema_version: number;
}
```

### 4.2 Algoritmo

Una lectura por tabla, todas en un `DB.batch()`:

```sql
SELECT <columns> FROM <tabla>
WHERE (version, <pk>) > (?1, ?2)
  [AND user_id = ?3]            -- tablas de alcance usuario
ORDER BY version, <pk>
LIMIT ?4;
```

Las filas eliminadas (`deleted_at` no nulo) **sí** viajan: así el cliente aplica el borrado.

Implementación (`apps/api/src/sync/pull.ts`, T-032): las columnas son las del registro (de `users` nunca baja `google_email`); `schema_version` se lee en el mismo batch; `changes` respeta el orden de tablas (padres primero) y solo incluye tablas con filas; `cursors` trae el cursor de **toda** tabla consultada (el mismo si no hubo filas). Una tabla desconocida en `tables` o en `cursors` → `400 E-VALIDATION_ERROR`. Una fila editada entre páginas avanza a su nueva versión y llega después: nunca se pierde.

### 4.3 Primer sync y volumen

Un dispositivo nuevo hace pull desde `[0, ""]` en todas las tablas hasta `has_more = false`. Con el volumen esperado (miles de filas) son pocas páginas.

## 5. Versión de esquema

- `sync_meta.schema_version` sube cuando cambian columnas o tablas sincronizadas.
- Cambio compatible (columna nueva opcional): clientes viejos siguen funcionando (ignoran columnas desconocidas en pull; §3.3 protege en push).
- Cambio incompatible: se sube `MIN_CLIENT_SCHEMA`; clientes viejos reciben `426 E-UPGRADE_REQUIRED` y la app muestra "Actualiza la app para seguir sincronizando". Sus cambios quedan en el outbox hasta actualizar.

## 6. Android

### 6.1 Tablas locales

| Tabla Room | Propósito |
|---|---|
| Espejo de cada tabla `sync` y `down` | Mismos nombres de tabla y columna que D1 |
| `outbox(seq PK, table_name, row_id, enqueued_at)` único `(table_name, row_id)` | Filas con cambios por subir |
| `pending_uploads(id PK, kind, image_id, name, local_path, source_url, content_type, attempts, last_error, created_at)` único `(image_id, name)` | Binarios por subir (`kind='blob'`) o importaciones de catálogo abierto pendientes (`kind='import'`, con `source_url`, 10 §2.3) |
| `sync_cursors(table_name PK, version, last_id)` | Cursor de pull |
| `sync_issues(id PK, table_name, row_id, reason, details_json, created_at, resolved_at)` | Conflictos que requieren acción o aviso |

Convenciones de entidades:

```kotlin
@Serializable
@Entity(
    tableName = "products",
    indices = [Index("version"), Index("category_id"), Index("search_key")],
)
data class ProductEntity(
    @PrimaryKey val id: String,
    val name: String,
    val brand: String?,
    @ColumnInfo(name = "category_id") val categoryId: String?,
    @ColumnInfo(name = "display_unit") val displayUnit: String,
    val notes: String?,
    @ColumnInfo(name = "primary_image_id") val primaryImageId: String?,
    @ColumnInfo(name = "search_key") val searchKey: String,
    @ColumnInfo(name = "created_at") val createdAt: Long,
    @ColumnInfo(name = "updated_at") val updatedAt: Long,
    @ColumnInfo(name = "deleted_at") val deletedAt: Long?,
    @ColumnInfo(name = "updated_by") val updatedBy: String?,
    val version: Long = 0,
)
```

- El `Json` de sync usa `namingStrategy = JsonNamingStrategy.SnakeCase`, `ignoreUnknownKeys = true`, `explicitNulls = true` y `encodeDefaults = true`, así la misma data class sirve para Room y para la red. `encodeDefaults` es necesario: sin él una columna `null` con valor por omisión no viajaría y el push no podría borrar un valor (`MaunedasJson` en `core:network`).
- Booleanos de D1 (0/1): propiedades `Int` en la entidad; el modelo de dominio los expone como `Boolean`.
- Sin llaves foráneas en Room (el orden de llegada no está garantizado); la integridad se valida en el servidor.
- Toda consulta de UI filtra `deleted_at IS NULL`.
- `@DatabaseView` `v_price_points` con el mismo SQL de `esquema-d1.sql`.

Implementación (T-102, `core:database`):
- **Contrato:** `packages/shared/sync-schema.json` sale del registro de sync y de `esquema-d1.sql` (`packages/shared/test/sync-schema.test.ts`, que falla si deja de coincidir; se regenera con `UPDATE_SYNC_SCHEMA=1 pnpm --filter shared test`).
- **Pruebas de Room (Robolectric, base en memoria):** `SchemaContractTest` compara cada tabla de Room con ese contrato (nombre, tipo y `NOT NULL` de cada columna, llave primaria, sin tablas de más); `ViewParityTest` exige que el SQL de la vista sea el de `esquema-d1.sql`; `PricePointsFixtureTest` pasa `prorrateo_ticket`.
- **Booleanos:** son `Int` (0/1).
- **Índices:** sin los índices únicos parciales de D1 (Room no los expresa y la unicidad la cuida el servidor, 04 §3.2); índices simples en las columnas `*_id`, `search_key`, `code`, `purchased_at` y `observed_at`.
- **Outbox:** `OutboxDao.nextBatch` ordena por el `order` del registro (padres antes que hijos) y luego por `seq`; una prueba lo verifica con las 17 tablas sync.
- **Esquema exportado:** en `apps/android/core/database/schemas/` (versión 1).

### 6.2 Escritura local

```kotlin
class LocalWriter @Inject constructor(
    private val db: AppDatabase,
    private val clock: Clock,
    private val session: SessionStore,
    private val scheduler: SyncScheduler,
) {
    /** Toda escritura de dominio pasa por aquí: fija metadatos, encola y agenda sync. */
    suspend fun <T : SyncEntity> write(table: SyncTable<T>, rows: List<T>) = db.withTransaction {
        val now = clock.nowMillis()
        val userId = session.userId()
        val stamped = rows.map { table.stamp(it, updatedAt = now, updatedBy = userId) }
        table.dao(db).upsertAll(stamped)
        db.outbox().enqueueAll(stamped.map { OutboxEntry(tableName = table.name, rowId = it.id, enqueuedAt = now) })
    }.also { scheduler.requestSoon() }

    suspend fun <T : SyncEntity> delete(table: SyncTable<T>, rows: List<T>) =
        write(table, rows.map { table.tombstone(it, clock.nowMillis()) })
}
```

Borrados en cascada los hace el cliente en la misma transacción:

| Se borra | También se marcan borrados |
|---|---|
| Compra | Sus líneas, sus promociones y sus imágenes de ticket |
| Línea | Sus promociones |
| Producto (admin) | Variantes, códigos, listings y reglas de alerta de esas variantes |
| Variante (admin) | Códigos, listings, reglas de alerta |

Las líneas de compra y observaciones de una variante borrada **se conservan** (historial); la UI muestra "(eliminado)".

### 6.3 `SyncWorker`

```kotlin
@HiltWorker
class SyncWorker @AssistedInject constructor(
    @Assisted ctx: Context, @Assisted params: WorkerParameters,
    private val auth: FirebaseAuth,
    private val db: AppDatabase,
    private val api: SyncApi,
    private val applier: PullApplier,
    private val conflicts: ConflictHandler,
    private val uploads: UploadScheduler,
    private val status: SyncStatusStore,
) : CoroutineWorker(ctx, params) {

    override suspend fun doWork(): Result {
        if (auth.currentUser == null) return Result.success()
        return try {
            pushAll()
            pullAll()
            uploads.enqueueIfPending()
            status.markSuccess()
            Result.success()
        } catch (e: IOException) {
            status.markError(e); Result.retry()
        } catch (e: UpgradeRequiredException) {
            status.markUpgradeRequired(); Result.success()
        }
    }

    private suspend fun pushAll() {
        val t0 = System.currentTimeMillis()
        while (true) {
            val batch = db.outbox().nextBatch(limit = 100, enqueuedBefore = t0)   // ORDER BY orden de tabla, seq
            if (batch.isEmpty()) return
            pushBatch(batch)
        }
    }

    private suspend fun pushBatch(batch: List<OutboxEntry>) {
        val mutations = RowLoader.load(db, batch)            // lee la fila actual de cada entrada
        val result = try {
            api.push(PushRequest(deviceId = DeviceId.get(), mutations = mutations))
        } catch (e: ApiException) {
            if (e.code != "BATCH_REJECTED") throw e
            if (batch.size == 1) {                          // aislar la fila problemática
                db.syncIssues().add(batch.single(), reason = "BATCH_REJECTED", details = e.details)
                db.outbox().remove(batch)
                return
            }
            batch.chunked((batch.size + 1) / 2).forEach { pushBatch(it) }
            return
        }
        conflicts.handle(result.conflicts)
        db.outbox().removeIfUnchanged(batch)                 // DELETE WHERE seq IN (…) AND enqueued_at = :original
    }

    private suspend fun pullAll() {
        do {
            val cursors = db.syncCursors().all()
            val res = api.pull(PullRequest(cursors = cursors, limit = 500))
            db.withTransaction {
                applier.apply(res.changes)                   // en orden de tabla
                db.syncCursors().save(res.cursors)
            }
        } while (res.hasMore)
    }
}
```

`removeIfUnchanged`: si el usuario editó la fila mientras se subía, la entrada del outbox tiene otro `enqueued_at` y no se borra; se sube en la siguiente vuelta.

Implementación (T-104, `core:sync`):
- **`SyncEngine` y `SyncWorker`:** la lógica de push y pull vive en `SyncEngine`, que se prueba con Room en memoria y MockWebServer; `SyncWorker` solo la llama y traduce el resultado: sin sesión → éxito sin red; `IOException`, 5xx o 429 → `retry`; otro 4xx → `failure`; 426 → éxito con `SyncStatus.UpgradeRequired`.
- **Push:** un lote rechazado completo se divide también ante `413 PAYLOAD_TOO_LARGE` (filas grandes que no caben en 512 KB). Una fila que se queda sola y sigue rechazada pasa a `sync_issues` y sale del outbox. Las filas viajan sin `version`, y una entrada cuya fila ya no existe se descarta.
- **Pull:** usa `limit = 100` (T40), no 500.
- **Estado y avisos:** `SyncStatusStore` expone el estado y los avisos de `STALE` en memoria.
- **Hecho en T-110:** `MaunedasApplication` registra `ForegroundSync` en `ProcessLifecycleOwner` y configura WorkManager con `HiltWorkerFactory`; `IdTokenProvider` y `CurrentUser` vienen de `core:auth`.
- **Pull completo sin `tables`:** el cliente omite la clave; `PullRequestSchema` la acepta ausente o como lista, nunca `null` (T53).

### 6.4 Aplicar filas del pull

```kotlin
class PullApplier @Inject constructor(private val db: AppDatabase) {
    suspend fun apply(changes: Map<String, List<JsonObject>>) {
        for (table in SyncTables.inOrder()) {
            val rows = changes[table.name] ?: continue
            for (json in rows) {
                val incoming = table.decode(json)
                val pending = db.outbox().contains(table.name, incoming.id)
                val local = table.dao(db).find(incoming.id)
                if (pending && local != null && local.updatedAt > incoming.updatedAt) continue   // el local ganará al subir
                table.dao(db).upsert(incoming)
            }
        }
    }
}
```

### 6.5 Conflictos en Android

| `reason` | Acción automática | Aviso |
|---|---|---|
| `STALE` | Reemplaza la fila local por `server_row` | Snackbar: "Otro dispositivo actualizó *<nombre>*" (solo tablas visibles: compras, productos, variantes) |
| `ALIAS_TAKEN` | Reemplaza por `server_row` | Ninguno |
| `BARCODE_TAKEN` | Registra `sync_issue` | Diálogo al abrir la app: "Este código ya pertenece a *<variante>*". Opciones: **Usar esa variante** (reasigna localmente líneas, observaciones, listings, reglas, alias e imágenes de mi variante a la existente y borra mi código) · **Mantener separado** (borra mi código) |
| `VALIDATION`, `FORBIDDEN`, `IMMUTABLE_ROW` | Si hay `server_row`, la restaura; si no, marca la fila local como rechazada | Ajustes → "Cambios rechazados" con el motivo (`details.reason`: `MISSING_PARENT`, `MEASURE_LOCKED`, `DUPLICATE_IN_BATCH`, `ADMIN_DELETE`, …) |

### 6.6 Programación

| Disparador | Trabajo |
|---|---|
| Cada escritura local (`requestSoon`) | `OneTimeWorkRequest` único `sync-now`, `ExistingWorkPolicy.APPEND_OR_REPLACE`, retraso inicial 3 s, restricción `CONNECTED` |
| App en primer plano | Además, un pull cada 60 s mientras está visible (`ProcessLifecycleOwner`) |
| Periódico | `PeriodicWorkRequest` 15 min `sync-periodic`, `KEEP`, `CONNECTED` |
| Botón "Sincronizar ahora" | `sync-now` con `setExpedited(RUN_AS_NON_EXPEDITED_WORK_REQUEST)` |

`UploadWorker` (ver `10-imagenes.md` §4) corre después de un push exitoso, con `CONNECTED` y reintentos exponenciales.

## 7. Web

La web no guarda datos locales: escribe con push y refresca las consultas.

```ts
// apps/web/src/lib/sync.ts
import { uuidv7 } from '@maunedas/shared/util/uuid';

export function newRow<T extends object>(fields: T) {
  const now = Date.now();
  return { id: uuidv7(), created_at: now, updated_at: now, deleted_at: null, ...fields };
}

export function touch<T extends { updated_at: number }>(row: T): T {
  return { ...row, updated_at: Math.max(Date.now(), row.updated_at + 1) };
}

export async function push(mutations: Array<{ table: string; row: object }>) {
  const res = await api.post<PushResponse>('/v1/sync/push', { device_id: webDeviceId(), mutations });
  if (res.conflicts.length) notifyConflicts(res.conflicts);    // toast + invalidación
  await queryClient.invalidateQueries();
  return res;
}
```

- `webDeviceId()`: UUID en `localStorage` (con try/catch; si falla, uno por sesión).
- Formularios grandes (compra) envían la compra, sus líneas y promociones en un solo push (≤ 100 filas; si hay más, se divide respetando el orden de tablas).

## 8. Pruebas mínimas

| Caso | Dónde |
|---|---|
| Insertar, actualizar con `updated_at` mayor, ignorar con menor, reintento idéntico idempotente | Worker (Vitest + D1 local) |
| Clamp de `updated_at` a `now + 5 min` | Worker |
| Columnas ausentes no se borran (§3.3) | Worker |
| `BARCODE_TAKEN`, `ALIAS_TAKEN`, `IMMUTABLE_ROW`, `FORBIDDEN` (miembro borra producto, regla ajena, observación web) | Worker |
| `BATCH_REJECTED` y división del lote en Android | Worker + Android (MockWebServer) |
| Pull con muchas filas de la misma `version` no salta filas (cursor compuesto) | Worker |
| Pull filtra `alert_rules` y `alert_events` por usuario | Worker |
| `PullApplier` respeta cambios locales pendientes más nuevos | Android (Room en memoria) |
| Edición durante push no se pierde (`removeIfUnchanged`) | Android |
| Dos emuladores editan la misma compra sin red y luego sincronizan: gana el último y el otro recibe aviso | Manual |
