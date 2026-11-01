# 07 · Agente casero

Requisitos: RF-TRK-01 a 05, RF-BAK-01 a 04, RF-ADM-03 (E2); RF-IMG-04 (E3). Corre en el servidor Ubuntu (HP Pavilion, AMD A8-7410) dentro del Docker Compose existente.

## 1. Rol y límites

- Hace: scraping programado de listings, (E3) quitar fondo de imágenes, respaldos.
- No hace: servir nada, recibir conexiones, llamar a proveedores de IA, decidir alertas.
- Habla solo con `https://maunedas.<subdominio>.workers.dev/agent/v1/*` usando `AGENT_TOKEN`.
- Si se apaga, el resto del sistema sigue funcionando (RNF-02). Al volver, retoma desde su SQLite local.

## 2. Paquete

```
agent/
├── pyproject.toml              # uv; extras: [browser], [images]
├── uv.lock
├── Dockerfile
├── compose.yaml                # proyecto de compose propio (`maunedas`)
├── .env.example
├── maunedas_agent/
│   ├── __main__.py             # arranque: config, logging, loops asyncio, apagado limpio
│   ├── config.py               # pydantic-settings
│   ├── api.py                  # cliente httpx de /agent/v1 (reintentos, auth)
│   ├── store.py                # SQLite local (§4)
│   ├── loops/
│   │   ├── poll.py             # /work cada 60 s + heartbeat
│   │   ├── scrape.py           # elige vencidos y ejecuta adapters
│   │   ├── flush.py            # envía resultados en lotes de ≤ 20
│   │   ├── images.py           # (E3) trabajos remove_bg
│   │   └── backup.py           # espejo diario, volcado semanal, rclone
│   ├── fetch/
│   │   ├── http.py             # httpx.AsyncClient con cookies por dominio
│   │   ├── browser.py          # Playwright (un contexto persistente)
│   │   └── gate.py             # separación mínima por dominio
│   ├── extract/
│   │   ├── jsonld.py           # schema.org Product/Offer
│   │   ├── embedded.py         # __NEXT_DATA__ y similares
│   │   ├── money.py            # parse_mxn
│   │   └── blocks.py           # detección de captcha/bloqueo
│   ├── adapters/
│   │   ├── base.py             # Adapter, ScrapeResult, FetchContext
│   │   ├── registry.py
│   │   ├── amazon_mx.py  sams_mx.py  costco_mx.py
│   ├── images/remove_bg.py     # (E3)
│   └── health.py               # healthcheck del contenedor
└── tests/
    ├── fixtures/html/<adapter>/*.html   # páginas reales guardadas (spike B y fallos)
    ├── test_money.py  test_jsonld.py  test_adapters.py  test_scheduler.py  test_gate.py
```

**Implementación (T-200, decisión T84):**
- **Arranque:** `__main__.py` corre los ciclos con `asyncio`. Ante `SIGTERM` cancela el que esté esperando la red y cierra limpio; la SQLite es síncrona, así que ninguna transacción queda a medias.
- **Ciclos:** una falla de un ciclo se registra y el ciclo sigue. Por ahora solo existe `poll`; los demás llegan con T-202 y siguientes.
- **`poll`:**
  - Toma hasta 25 páginas de `/work` por vuelta.
  - Guarda listings, quitados, `store_defaults`, cursor y `min_spacing_s` en una sola transacción por página.
  - Agenda cada "Revisar ahora" una sola vez, aunque `/work` lo repita hasta que llegue el resultado (`check_now_seen` en `kv`).
  - Reporta en `info` el último error (máximo 500 caracteres) hasta que una vuelta salga bien.
- **`api.py`:** reintenta 3 veces (esperas de 2 y 8 s) solo errores de red, 5xx y 429; un 4xx falla de inmediato.
- **Registros:** líneas JSON con `structlog`. Las llaves `token`, `authorization`, `cookie(s)` y `password` se reemplazan por `[oculto]`.
- **`info.blocked`:** cuenta solo listings activos.

## 3. Configuración

```dotenv
# agent/.env.example — copiar a agent/.env (no se versiona)
API_BASE=https://maunedas.<subdominio>.workers.dev
AGENT_TOKEN=<64 caracteres aleatorios; en el Worker se guarda su sha256>
AGENT_ID=home
TZ=America/Mexico_City
DATA_DIR=/data
LOG_LEVEL=INFO

POLL_INTERVAL_S=60
SCRAPE_TICK_S=30
MAX_HTTP_CONCURRENCY=2
MAX_BROWSER_CONCURRENCY=1
PLAYWRIGHT_ENABLED=true
BROWSER_RESTART_EVERY=50          # reinicia Chromium cada N páginas
REFERENCE_POSTAL_CODE=72750
HTTP_TIMEOUT_S=20
BROWSER_TIMEOUT_S=40

BACKUP_ENABLED=true
BACKUP_HOUR=3                     # hora local
BACKUP_WEEKDAY=6                  # 0=lunes … 6=domingo (volcado semanal)
BACKUP_KEEP_WEEKLY=8
R2_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
R2_BUCKET=maunedas-images
R2_ACCESS_KEY_ID=<token de solo lectura>
R2_SECRET_ACCESS_KEY=<…>

IMAGES_ENABLED=false              # E3
REMBG_MODEL=isnet-general-use     # decisión D5 (spike A)
```

## 4. SQLite local (`/data/agent.sqlite`)

```sql
CREATE TABLE listing_cfg (
  id            TEXT PRIMARY KEY,
  adapter       TEXT NOT NULL,
  url           TEXT NOT NULL,
  canonical_url TEXT,
  external_id   TEXT,
  store_id      TEXT NOT NULL,
  interval_min  INTEGER,                 -- NULL = default de la tienda
  active        INTEGER NOT NULL,
  version       INTEGER NOT NULL
);

CREATE TABLE store_defaults (store_id TEXT PRIMARY KEY, interval_min INTEGER NOT NULL);

CREATE TABLE schedule (
  listing_id       TEXT PRIMARY KEY,
  next_check_at    INTEGER NOT NULL,     -- epoch ms
  backoff_level    INTEGER NOT NULL DEFAULT 0,
  block_streak     INTEGER NOT NULL DEFAULT 0,
  last_status      TEXT,
  last_checked_at  INTEGER
);

CREATE TABLE outbox (                    -- resultados aún no aceptados por el Worker
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id  TEXT NOT NULL,
  payload     TEXT NOT NULL,             -- JSON de AgentResult
  created_at  INTEGER NOT NULL
);

CREATE TABLE domain_gate (domain TEXT PRIMARY KEY, last_request_at INTEGER NOT NULL);
CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);   -- cursores, marcas de respaldo
```

El `outbox` hace que ningún resultado se pierda si el Worker o internet fallan.

## 5. Contratos `/agent/v1`

Auth: `Authorization: Bearer <AGENT_TOKEN>`. El Worker calcula `sha256(token)` y lo compara en tiempo constante con `AGENT_TOKEN_SHA256`. Fallo → `401`.

### 5.1 `POST /agent/v1/work`

```jsonc
// request
{
  "agent_id": "home",
  "agent_version": "1.0.0",
  "cursor": [118, "0192…"],                  // listings; [0, ""] la primera vez
  "info": {
    "outbox": 0, "due": 3, "mem_mb": 612, "load1": 0.8,
    "blocked": ["sams_mx"],                  // adapters con listings bloqueados
    "last_error": null
  }
}
```

```jsonc
// 200
{
  "server_time": 1759270000000,
  "listings": {
    "upserts": [
      { "id": "0192…", "adapter": "amazon_mx", "url": "…", "canonical_url": "…", "external_id": "B0…",
        "store_id": "…", "interval_min": null, "active": 1, "version": 119 }
    ],
    "removed": ["0192…"],                    // eliminados o desactivados
    "cursor": [119, "0192…"],
    "has_more": false
  },
  "store_defaults": { "<store_id>": 480 },
  "check_now": ["0192…"],                    // check_requested_at > COALESCE(last_checked_at, 0)
  "image_jobs_queued": 0,
  "config": { "min_spacing_s": { "amazon_mx": 45, "sams_mx": 30, "costco_mx": 30, "default": 20 } }
}
```

Del lado del Worker:
- Actualiza `agent_status` (`last_heartbeat_at`, `agent_version`, `info`). Solo asigna nueva `version` (y por tanto baja a los clientes) si cambió `info.blocked`, si el agente estaba fuera de línea o si pasaron ≥ 10 min desde la última versión.
- Si el agente estaba fuera de línea y el watchdog había avisado, borra la marca para avisar de nuevo en la siguiente caída.

**Implementación (T-201, decisión T78):**
- **Token:** `src/agent/auth.ts` compara en tiempo constante el SHA-256 hexadecimal del bearer con `AGENT_TOKEN_SHA256`. Sin token, con otro token o sin hash configurado → `401`. El token se genera una vez en `agent/.env` con `apps/api/scripts/agent-token.sh dev|prod`, que solo sube su hash.
- **Listings:** páginas de 200 por `(version, id)`. `upserts` son los vivos y activos; `removed` los borrados o inactivos de la misma página. Sin filas nuevas, el cursor se devuelve igual.
- **`store_defaults`:** todas las tiendas vivas. **`check_now`:** listings vivos y activos, en orden de solicitud.
- **`agent_status`:**
  - Siempre guarda latido, versión del agente e `info`; `info.blocked` se guarda como conjunto ordenado, así un cambio de orden no cuenta. Los campos que el agente agregue a `info` se conservan, con un máximo de 4000 caracteres (`413` si se pasa).
  - Nueva `version` (los clientes la bajan) si cambió el conjunto bloqueado, si el agente estaba fuera de línea (latido de hace ≥ 3 min, el mismo umbral de "en línea" de `GET /v1/admin/agent`) o si pasaron ≥ 10 min desde la última versión. `updated_at` es la hora de esa última versión.
  - Al volver de una caída borra la marca del watchdog: `agent_offline_notified` en `token_cache`, que escribirá T-214.

### 5.2 `POST /agent/v1/observations`

```jsonc
// request — 1..20
{
  "results": [
    {
      "listing_id": "0192…",
      "checked_at": 1759270000000,
      "status": "ok",                         // ok | not_found | blocked | error
      "price_cents": 2899,
      "list_price_cents": 3299,
      "in_stock": true,
      "promo_text": null,
      "extra": { "seller": "Amazon México", "method": "http_jsonld" },
      "error": null
    }
  ]
}
// 200
{ "accepted": 1, "observations_created": 1 }
```

Idempotencia: si llega un resultado con `checked_at <= listing_state.last_checked_at`, se ignora (reintento del outbox).

### 5.3 Trabajos de imagen (E3)

| Ruta | Contrato |
|---|---|
| `POST /agent/v1/jobs/claim` | `{}` → `200 { job: { id, image_id, op, original_url } }` o `204` si no hay. Lease de 10 min; tras 3 intentos → `failed` |
| `GET /agent/v1/images/:imageId/original` | Binario del original |
| `PUT /agent/v1/jobs/:jobId/result/:kind` | `kind ∈ mask \| processed \| thumb`; cuerpo PNG (mask) o WebP. Crea `image_renditions` (`tier='home'`). `201 { rendition_id }` |
| `POST /agent/v1/jobs/:jobId/complete` | `204` |
| `POST /agent/v1/jobs/:jobId/fail` | `{ error }` → `204` |

```sql
-- claim atómico en D1
UPDATE image_jobs
SET status = 'claimed', claimed_at = ?1, attempts = attempts + 1, updated_at = ?1
WHERE id = (
  SELECT id FROM image_jobs
  WHERE (status = 'queued') OR (status = 'claimed' AND claimed_at < ?1 - 600000)
  ORDER BY created_at LIMIT 1
)
RETURNING *;
```

### 5.4 `POST /agent/v1/backup/pull`

Igual que `/v1/sync/pull` (`04-sincronizacion.md` §4) pero:
- sin filtro por usuario,
- `users` con todas sus columnas,
- incluye tablas de servidor necesarias para restaurar: `user_identities`, `receipt_extractions`, `ai_usage` (cursor `(created_at, pk)`).

**Implementación (T-230, ruta del Worker; decisión T88):**
- **Contenido:** `SELECT *` de todas las tablas del registro, de todos los usuarios y con lápidas, en orden de restauración (padres primero), con cursor `(version, pk)`.
- **Tablas del servidor:** `receipt_extractions` y `ai_usage` solo se agregan, así que van por `(created_at, pk)`.
- **`user_identities`:** viaja **completa** en cada respuesta (vacía también) y aparece en `replace`, que indica qué tablas sustituye el espejo en lugar de mezclar. El Worker borra filas de ella al quitar el acceso con Google, y un espejo por `created_at` conservaría ese acceso para una restauración.
- **Fuera del respaldo:**
  - `devices`, por sus tokens FCM, que se renuevan solos;
  - `token_cache`, `off_cache` e `image_jobs`, por ser caché y cola;
  - `sync_meta`: una restauración pone `version` en el máximo de las filas y `schema_version` según las migraciones.
- **Validación:** `limit`, `tables` y la validación son los de `/v1/sync/pull`. Un cursor para una tabla que viaja completa, o para una tabla fuera del respaldo, es `400`.

## 6. Worker: ingesta de observaciones (T-211)

```ts
// apps/api/src/agent/observations.ts
export async function ingest(env: Env, ctx: ExecutionContext, results: AgentResult[]) {
  const listings = await loadListingsWithState(env.DB, results.map((r) => r.listing_id));
  const now = Date.now();
  const stmts: D1PreparedStatement[] = [
    env.DB.prepare(`UPDATE sync_meta SET value = value + 1 WHERE key = 'version'`),
  ];
  const created: Array<{ obs: NewObservation; prev: ListingStateRow | null }> = [];
  const newlyBlocked: string[] = [];

  for (const r of results) {
    const l = listings.get(r.listing_id);
    if (!l || l.deleted_at) continue;
    const prev = l.state;
    if (prev?.last_checked_at && r.checked_at <= prev.last_checked_at) continue;   // reintento

    const ok = r.status === 'ok';
    const changed = ok && (
      prev?.last_status !== 'ok' ||
      prev.last_price_cents !== r.price_cents ||
      prev.last_list_price_cents !== (r.list_price_cents ?? null) ||
      prev.last_in_stock !== toInt(r.in_stock) ||
      (prev.last_promo_text ?? null) !== (r.promo_text ?? null)
    );

    stmts.push(upsertListingState(env.DB, l.id, r, prev));   // failures: consecutive_failures + 1; ok: 0
    if (changed) {
      const obs = webObservation(l, r, now);                  // id UUIDv7, source='web', updated_by='agent'
      stmts.push(insertObservation(env.DB, obs));
      created.push({ obs, prev });
    }
    if (r.status === 'blocked' && prev?.last_status !== 'blocked') newlyBlocked.push(l.id);
  }

  await env.DB.batch(stmts);
  ctx.waitUntil(afterIngest(env, created, newlyBlocked));    // alertas (08) y aviso de bloqueo al admin
  return { accepted: results.length, observations_created: created.length };
}
```

**Implementación (T-211, decisión T79):**
- **Orden:** los resultados se toman por `checked_at`, y cada uno se compara contra el anterior del mismo listing en la misma petición; así un lote con varias revisiones también se comprime. Un `checked_at` más de 5 min en el futuro se toma como "ahora".
- **Fallas:** `error` y `blocked` suman a `consecutive_failures` y conservan los últimos precios conocidos. `ok` y `not_found` lo reinician, porque la página respondió.
- **Sin precio:** un `ok` sin precio (agotado) actualiza el estado pero no crea observación, porque `price_cents` es obligatorio. Al volver con precio, el cambio de existencia la crea.
- **Observación:** `observed_at` es `checked_at`, `updated_by = 'agent'`, `extra` con un máximo de 4000 caracteres. El estado y la observación llevan la misma `version` nueva, una por petición (ninguna si todo era reintento).
- **Después de responder:** `afterIngest` avisa a los admins de cada listing que pasó a `blocked` (08 §5) y evalúa las alertas de las observaciones creadas con su estado anterior (08, T-212), todo por FCM (T-213).

## 7. Scheduler

```python
# maunedas_agent/loops/scrape.py (esencia)
async def tick(ctx: AgentContext) -> None:
    now = now_ms()
    due = ctx.store.due_listings(now, limit=10)            # ORDER BY next_check_at
    for item in due:
        adapter = registry.get(item.adapter)
        if adapter is None:
            continue
        if not await ctx.gate.try_acquire(adapter.gate_key, adapter.min_spacing_s):
            continue                                        # el dominio aún no puede recibir otra petición
        async with ctx.http_sem if not adapter.needs_browser else ctx.browser_sem:
            result = await run_adapter(adapter, item, ctx)
        ctx.store.outbox_add(result)
        ctx.store.reschedule(item.id, result, now_ms(), interval_min=effective_interval(item))

def next_check(result_status: str, backoff_level: int, interval_min: int, now: int) -> tuple[int, int]:
    """Devuelve (next_check_at, nuevo backoff_level)."""
    base = interval_min * 60_000
    if result_status == "ok" or result_status == "not_found":
        return now + int(base * random.uniform(0.9, 1.1)), 0
    level = min(backoff_level + 1, 6)
    delay = min(15 * 60_000 * (2 ** (level - 1)), 24 * 3_600_000)   # 15 min, 30, 60, … tope 24 h
    return now + int(delay * random.uniform(0.9, 1.1)), level
```

- `check_now` pone `next_check_at = now` (el gate por dominio sigue aplicando).
- Tres `blocked` seguidos en un listing → se reporta y el backoff sube al tope (24 h). No hay reintentos agresivos.
- `due_listings` excluye `active = 0`.

**Implementación (T-202, decisión T85):**
- **Agenda:**
  - Un listing activo sin agenda vence de inmediato.
  - El intervalo es el del listing, si no el de la tienda, si no 480 min.
  - Se revisa la `canonical_url` cuando existe.
  - Hasta 10 vencidos por vuelta (`SCRAPE_TICK_S`).
- **Separación:**
  - Se toma el dominio justo antes de la petición, ya dentro del cupo HTTP o de navegador; esperar cupo nunca acorta la separación.
  - La separación es la mayor entre la del adapter y la que manda el Worker (`config.min_spacing_s`, o `default`).
  - Un dominio ocupado deja el listing vencido para la vuelta siguiente.
  - `domain_gate` vive en la SQLite, así que un reinicio no la borra.
- **Backoff:**
  - Como en el código de arriba, los errores llegan hasta el nivel 6 (8 h).
  - El tope de 24 h solo se alcanza con 3 `blocked` seguidos: se registra `listing_blocked` y el admin ya recibió el aviso del Worker al primer bloqueo.
  - Un resultado distinto de `blocked` reinicia la racha.
- **Fallas del adapter:** una excepción es un resultado `error` con su mensaje (máximo 500 caracteres; promoción, máximo 300).
- **Resultado:** el resultado, su entrada en el `outbox` y la nueva agenda se guardan en una sola transacción.
- **`flush`:**
  - Envía en orden, de 20 en 20, y borra solo lo aceptado.
  - Red, 5xx, 429 o 401 dejan todo en la cola para la vuelta siguiente.
  - Un 400, 413 o 422 hace que se reenvíe uno por uno; el que el Worker rechaza solo se descarta con `result_rejected` y queda en `last_error`.
  - Un envío repetido tras un corte lo ignora el Worker por `checked_at` (§5.2).

## 8. Descarga y extracción

### 8.1 HTTP

```python
# maunedas_agent/fetch/http.py
HEADERS = {
    "User-Agent": CHROME_UA,                 # UA de Chrome estable reciente, fijo en config
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "es-MX,es;q=0.9,en;q=0.6",
}

def make_client(cookie_jar: httpx.Cookies) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        http2=True, headers=HEADERS, cookies=cookie_jar, follow_redirects=True,
        timeout=httpx.Timeout(settings.http_timeout_s),
        limits=httpx.Limits(max_connections=4, max_keepalive_connections=2),
    )
```

Las cookies por dominio se guardan en `kv` para mantener la sucursal/CP seleccionados entre reinicios.

### 8.2 Navegador (último recurso)

- Playwright Chromium headless con contexto persistente en `/data/browser-profile`.
- `route` que aborta `image`, `font`, `media` y dominios de analítica.
- `wait_until="domcontentloaded"` + espera del selector de precio (timeout `BROWSER_TIMEOUT_S`).
- Una página a la vez; reinicio del navegador cada `BROWSER_RESTART_EVERY` páginas o si RSS > 900 MB.

**Implementación (T-204, decisión T90):**
- **`fetch/browser.py`:**
  - Arranca Chromium la primera vez que se necesita y lo reinicia antes de una página si ya abrió `BROWSER_RESTART_EVERY` o si sus procesos pasan de 900 MB.
  - La memoria es la suma del RSS de los procesos hijos del agente, leída de `/proc`.
  - Bloquea imágenes, fuentes, medios y dominios de analítica.
  - Espera `domcontentloaded` y el `price_selector` del adapter; si no aparece, devuelve la página igual.
  - Siempre cierra la página.
- **Cuándo se usa:**
  - Solo como último recurso dentro de `BaseAdapter.fetch`: cuando la página HTTP cargó sin precio ni existencia.
  - Nunca ante un bloqueo (regla 10).
  - Antes de abrirlo, `wait_turn` espera a que el dominio admita otra petición, con la misma separación de §7.
  - `extra.method` dice `browser_…`.
- **Sin navegador:** no se crea si `PLAYWRIGHT_ENABLED` está apagado o falta Playwright (pruebas y CI; la imagen lo trae con el extra `browser`).
- **Comprobado con Chromium real en la imagen:**
  - se reinicia cada 2 páginas y por memoria;
  - espera un elemento que aparece tarde;
  - no hubo peticiones de imágenes;
  - Chromium ocupó unos 515 MB.

### 8.3 Precio

```python
# maunedas_agent/extract/money.py
import re
from decimal import Decimal, ROUND_HALF_UP

_NUM = re.compile(r"(\d{1,3}(?:[,\s]\d{3})+|\d+)(?:\.(\d{1,2}))?")

def parse_mxn(text: str | None) -> int | None:
    """'$1,299.00' → 129900 · 'MXN 45' → 4500 · '$28.5' → 2850. None si no hay número."""
    if not text:
        return None
    t = text.replace("\xa0", " ").replace("MXN", "").replace("$", "")
    m = _NUM.search(t)
    if not m:
        return None
    whole = int(re.sub(r"[,\s]", "", m.group(1)))
    frac = (m.group(2) or "0").ljust(2, "0")
    return whole * 100 + int(frac)

def decimal_to_cents(value: str | float | int) -> int:
    """Precios de JSON-LD ('1299.00', 1299) → centavos."""
    return int((Decimal(str(value)) * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
```

### 8.4 Detección de bloqueo

`blocks.py` devuelve `blocked` si: HTTP 403/429/503 con cuerpo que contiene marcadores de captcha (`captcha`, `validateCaptcha`, `px-captcha`, `Access Denied`), o el título de la página es de verificación. Cada adapter puede agregar marcadores propios.

**Implementación (T-203, decisión T86):**
- **HTTP (`fetch/http.py`):**
  - Un solo cliente HTTP/2 con los headers de §8.1.
  - El UA es el de Chrome 153, la versión del Chromium de la imagen, y se cambia con `CHROME_UA`.
  - El jar de cookies completo se guarda en `kv` (`http_cookies`) después de cada página, sin las vencidas. Cada dominio recibe solo las suyas.
  - Los errores de red llegan al adapter; si no los maneja, el ciclo los convierte en `error`.
- **Precio (`money.py`):**
  - `parse_mxn` es la del código de arriba.
  - `decimal_to_cents` devuelve `None` para lo que no es un precio: texto, NaN, infinito, negativos o booleanos.
  - Un precio de JSON-LD con formato de texto ("1,299.00") se lee con `parse_mxn`.
- **JSON-LD (`jsonld.py`):**
  - Recorre listas y `@graph`.
  - `@type` sin distinguir mayúsculas, como el `product` de Costco.
  - Usa la primera oferta en pesos con precio, o si no la primera oferta; para `AggregateOffer`, `lowPrice`.
  - `availability` se acepta con o sin URL de schema.org: `InStock`, `LimitedAvailability`, `InStoreOnly`, `OnlineOnly`, `PreSale` y `PreOrder` cuentan como disponible; `OutOfStock`, `SoldOut` y `Discontinued` como agotado; lo demás queda en `None`.
  - Un bloque roto no oculta los demás.
- **Estado embebido (`embedded.py`):** `next_data` y `dig("a.b.0.c")`.
- **Bloqueos (`blocks.py`):**
  - Los marcadores débiles (`captcha`, `access denied`) solo cuentan con 403/429/503.
  - Los fuertes cuentan con cualquier estado: `validatecaptcha`, `px-captcha`, `captcha-delivery.com` y `/cdn-cgi/challenge-platform`, más los del adapter.
  - También cuentan una ruta final `/blocked` y un título de verificación ("Verifica tu identidad", "Robot Check", "Just a moment"…), porque los retos llegan con 200.
- **HTML:** se lee con `selectolax.lexbor` (`extract/html.py`).

## 9. Adapters

```python
# maunedas_agent/adapters/base.py
@dataclass
class ScrapeResult:
    status: Literal["ok", "not_found", "blocked", "error"]
    price_cents: int | None = None
    list_price_cents: int | None = None
    in_stock: bool | None = None
    promo_text: str | None = None
    extra: dict = field(default_factory=dict)
    error: str | None = None

class Adapter(Protocol):
    name: str
    domains: tuple[str, ...]
    gate_key: str                  # normalmente == name
    min_spacing_s: int
    needs_browser: bool            # True si se sabe que HTTP nunca funciona

    def canonicalize(self, url: str) -> tuple[str, str | None]: ...
    async def fetch(self, url: str, ctx: FetchContext) -> ScrapeResult: ...
```

`canonicalize` sigue las mismas reglas que el Worker (`packages/shared/src/tracking/urls.ts`) y se prueba con `fixtures/enlaces.json` (T-210).

Estrategia común (`BaseAdapter.fetch`): HTTP → JSON-LD → estado embebido → selectores → Playwright. Cada paso registra `extra.method` para saber qué funciona.

Resultado del spike B (T-011, 2026-10-19; detalle en `docs/spikes/spike-b-scraping.md`, fixtures en `agent/tests/fixtures/html/`). Ninguna tienda necesitó navegador:

| Adapter | Dominios | Canónica e id | Fuente del precio | Notas |
|---|---|---|---|---|
| `amazon_mx` | `amazon.com.mx` (`amzn.to`, `a.co` se resuelven en el Worker) | `https://www.amazon.com.mx/dp/{ASIN}`; ASIN con `/(?:dp\|gp/product\|gp/aw/d)/([A-Z0-9]{10})` | HTTP + selectores: `#corePriceDisplay_desktop_feature_div .apex-pricetopay-value .a-offscreen`. No hay JSON-LD de producto. El primer `.a-text-price` es el precio **por unidad**, no el de lista (lista: `.basisPrice`, por confirmar con fixture) | Separación 45 s. "No disponible por el momento" → `in_stock=false` sin precio. Vendedor en `#merchantInfoFeature_feature_div`. Ubica por IP (Cholula 72760): no hace falta fijar CP |
| `sams_mx` | `sams.com.mx` | Id de producto al final de la ruta `/ip/…/{id}` | HTTP + JSON-LD; precio de lista y stock en `__NEXT_DATA__` → `props.pageProps.initialData.data.product` (`priceInfo.currentPrice.price`, `priceInfo.wasPrice`, `availabilityStatus`). Un recorrido genérico encuentra primero los carruseles | Sin sesión usa un club por defecto de CDMX (CP 11220); T-207 revisa si el precio cambia por club y cómo fijar uno de Puebla. Si un precio requiere sesión de socio: `extra.member_only = true` |
| `costco_mx` | `costco.com.mx` | Código de producto en `/p/{code}` | HTTP + JSON-LD (`"@type": "product"` en minúsculas: comparar sin distinguir mayúsculas) | En el DOM, solo `sip-product-details` es del producto; el primer `.product-price-amount` y los "Agotado" de la página son del carrusel |

Walmart (`walmart.com.mx` y `super.walmart.com.mx`) no tiene adapter: responde con captcha de PerimeterX desde la primera petición HTTP y por la regla 10 no se sigue (decisión T34). Su página de bloqueo queda como fixture (`walmart_mx/bloqueo.html`) para probar `blocks.py`.

Extracción: `selectolax` ≥ 1.0 ya no trae el parser Modest; usar `selectolax.lexbor.LexborHTMLParser`.

**Implementación (T-205, T-207, T-208; decisión T87):**
- **Camino común (`adapters/common.py`):**
  - Página HTTP, luego bloqueo (§8.4).
  - 404/410 → `not_found`; otro ≥ 400 → `error`.
  - Después, la lectura de la tienda. Si no encuentra ni precio ni existencia → `error` "no se encontró el precio en la página", y la página se guarda en `/data/fallos/<adapter>/` (las 20 más nuevas) para convertirla en fixture.
  - `extra.http_status` acompaña cada resultado.
  - `canonicalize` usa `maunedas_agent/urls.py`, que pasa `fixtures/enlaces.json` igual que el Worker.
- **`amazon_mx`:**
  - Se quitan `style`, `script` y `noscript` antes de leer textos.
  - Precio a pagar: `.apex-pricetopay-value .a-offscreen`, que en la página real viene vacío; luego `#apex-pricetopay-accessibility-label`; luego los dígitos visibles; luego el diseño anterior (`.a-price` sin tachar y sin ser por unidad).
  - Lista: `.apex-basisprice-value`, `.basisPrice` o un `.a-price` tachado, solo si es mayor.
  - "No disponible" o `#outOfStock` → `in_stock = false` sin precio.
  - Promoción: `#promoPriceBlockMessage_feature_div`. Vendedor en `extra.seller`.
- **`sams_mx`:**
  - Producto de `__NEXT_DATA__`: `currentPrice`, `wasPrice` o `listPrice` (solo si es mayor) y `availabilityStatus`.
  - Promoción: los `badges.flags` con número, como "11 x 10"; "MSI" no cuenta.
  - `extra.club` y `extra.postal_code` dicen qué club dio el precio.
  - Si `__NEXT_DATA__` no sirve, se usa JSON-LD.
- **`costco_mx`:**
  - JSON-LD.
  - Si falla, `.product-price-amount` solo dentro de `sip-product-details`, nunca el primero de la página.
  - Sin precio de lista: no se conoce su marcado.
- **Comprobación real (2026-11-01, una petición por tienda desde el servidor):**
  - Amazon $118.69: ahora ubica la IP en "Puebla City 72210".
  - Sam's $322.24: club por defecto `0000009996`, CP 11220, en la CDMX.
  - Costco $529.00.
  - La página de Amazon trajo una promoción y quedó como fixture `amazon_mx/ok_con_promocion.html`.

## 10. Respaldos (T-230)

| Trabajo | Cuándo | Qué hace |
|---|---|---|
| Espejo | Diario, `BACKUP_HOUR` | `backup/pull` incremental hasta `has_more=false`; aplica filas a `/data/backups/mirror.sqlite` (creado con las migraciones de `apps/api/migrations`, copiadas en la imagen) |
| Volcado | `BACKUP_WEEKDAY` | `sqlite3 mirror.sqlite .dump \| gzip > weekly/maunedas-YYYY-MM-DD.sql.gz`; conserva `BACKUP_KEEP_WEEKLY` |
| Fotos | Diario, después del espejo | `rclone sync r2:maunedas-images /data/backups/r2` con token de solo lectura |

Resultado de cada trabajo en `kv` y en `info` del siguiente `/work` (visible en W-22).

**Implementación (T-230, agente; decisión T89):**
- **Horario:** `loops/backup.py` revisa cada 5 min si ya pasó `BACKUP_HOUR` en `TZ`.
  - Cada trabajo tiene su propia marca del día (`backup_mirror_day`, `backup_dump_day`, `backup_photos_day`), así que uno que falla se reintenta sin repetir los otros.
  - El volcado y las fotos esperan al espejo del día.
- **Espejo (`backup.py`):**
  - `/data/backups/mirror.sqlite` se crea con las migraciones de `MIGRATIONS_DIR` (`/app/migrations` en la imagen). Las migraciones nuevas se aplican al arrancar cada corrida, una sola vez y cada una en su transacción (registro en `_mirror_migrations`).
  - Cada página se aplica con sus cursores en una sola transacción (`_mirror_cursors`): `INSERT … ON CONFLICT(pk) DO UPDATE`, y para las tablas de `replace`, borrar y volver a insertar.
  - Una tabla o columna que el espejo no conoce detiene la página sin escribir nada (`SchemaMismatch`): falta una migración en la imagen.
- **Volcado:**
  - `iterdump` comprimido con gzip, sin las tablas `_mirror_*`.
  - Se escribe a `.partial` y se renombra al terminar; si falla, no queda archivo.
  - Se conservan los `BACKUP_KEEP_WEEKLY` más nuevos.
- **Fotos:**
  - `rclone sync r2:<R2_BUCKET> /data/backups/r2` con el remoto armado por variables `RCLONE_CONFIG_R2_*` (proveedor Cloudflare, `no_check_bucket` porque el token es de solo lectura).
  - Las llaves solo llegan al proceso de rclone. La imagen trae rclone 1.60.1.
  - Sin credenciales se reporta "sin credenciales de R2"; si rclone falla, se reintenta a la hora.
- **Estado:** queda en `kv` `backup_status` y viaja en `info.backup` de `/work`. Un fallo también queda en `last_error`.

## 11. Imágenes (E3, T-300)

```python
# maunedas_agent/images/remove_bg.py
from rembg import new_session, remove
from PIL import Image

_session = None

def process(original: bytes, model: str) -> tuple[bytes, bytes, bytes]:
    """Devuelve (mask_png, processed_webp, thumb_webp)."""
    global _session
    _session = _session or new_session(model)
    img = Image.open(io.BytesIO(original)).convert("RGB")
    img.thumbnail((2048, 2048))
    cut = remove(img, session=_session)                    # RGBA
    alpha = cut.getchannel("A")
    bbox = alpha.getbbox() or (0, 0, *cut.size)
    cut = pad_square(cut.crop(bbox), pad_ratio=0.08)        # centra con margen
    processed = to_webp(cut, max_side=1024, keep_alpha=True)
    thumb = to_webp(flatten(cut, "#FFFFFF"), max_side=256)
    mask = to_png(cut.getchannel("A"))
    return mask, processed, thumb
```

Se procesa un trabajo a la vez; el modelo se carga una sola vez.

## 12. Docker

```dockerfile
# agent/Dockerfile — contexto de build: raíz del repo
FROM mcr.microsoft.com/playwright/python:<versión fijada>-noble
RUN apt-get update && apt-get install -y --no-install-recommends rclone sqlite3 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
WORKDIR /app
COPY agent/pyproject.toml agent/uv.lock ./
RUN uv sync --frozen --no-dev --extra browser
COPY agent/maunedas_agent ./maunedas_agent
COPY apps/api/migrations ./migrations
ENV PYTHONUNBUFFERED=1
HEALTHCHECK --interval=60s --timeout=10s CMD ["uv", "run", "python", "-m", "maunedas_agent.health"]
CMD ["uv", "run", "python", "-m", "maunedas_agent"]
```

**Implementación (T-200):**
- **Versiones:** imagen `playwright/python:v1.63.0-noble` con `playwright==1.63.0`, las que validó el spike B y la imagen que ya está en el servidor. `uv` está fijado en `0.13.1`.
- **Arranque:** se usa el Python del venv (`/app/.venv/bin`) en lugar de `uv run`, que instalaría el grupo de desarrollo al arrancar.
- **Contexto:** `agent/Dockerfile.dockerignore` deja pasar solo lo que se copia.
- **Healthcheck:** `--start-period=30s`.
- **Comprobado en el servidor con `docker run --rm`, sin tocar el compose:**
  - el agente arranca y crea `/data/agent.sqlite`;
  - el healthcheck responde;
  - Chromium abre;
  - `docker stop` termina en menos de 1 s.

La versión de la imagen de Playwright y la del paquete `playwright` de Python deben coincidir. En E3 se agrega `--extra images` y se descarga el modelo de rembg durante el build.

```yaml
# agent/compose.yaml — proyecto de compose propio del agente (decisión T91)
name: maunedas
services:
  maunedas-agent:
    build:
      context: ..
      dockerfile: agent/Dockerfile
    image: maunedas-agent:latest
    restart: unless-stopped
    env_file: .env
    volumes:
      - ${MAUNEDAS_DATA:-../../datos-agente}:/data   # fuera del repo
    mem_limit: 1200m          # spike B: pico de Chromium 759 MB; Playwright solo como último recurso
    cpus: 1.5
    shm_size: 512m
    logging:
      driver: json-file
      options: { max-size: "10m", max-file: "3" }
```

En el servidor, Home Assistant corre como contenedor suelto y no hay un compose donde pegar un fragmento, así que el agente tiene su propio proyecto (`docker compose -f agent/compose.yaml up -d --build` desde la raíz del repo), que no toca a los demás contenedores. Corre desde el 2026-11-01 contra `maunedas-dev`, con los datos en `~/proyectos/maunedas/datos-agente`.

## 13. Registro y salud

- Logs JSON a stdout (`structlog`): `listing_id`, `adapter`, `status`, `method`, `ms`.
- `health.py` falla si el último tick de `poll` tiene más de 3 min.
- Nunca se registran cookies ni el token.

## 14. Pruebas

| Suite | Casos |
|---|---|
| `test_money.py` | `$1,299.00`→129900, `$ 28.50`→2850, `MXN 45`→4500, `$28.5`→2850, `1 299,00`→129900, `Precio: $89.90 c/u`→8990, `$0.99`→99, vacío→None. `parse_mxn` recibe el texto del **elemento de precio**, no frases con cantidades ("2 x $28.50" daría 200) |
| `test_jsonld.py` | Product con `offers` objeto, lista, `AggregateOffer`; `availability` InStock/OutOfStock |
| `test_adapters.py` | Por adapter: fixtures `ok`, `sin stock`, `con precio de lista`, `captcha` → `ScrapeResult` esperado |
| `test_scheduler.py` | `next_check` (jitter dentro de rango, backoff y tope), `check_now`, listings inactivos no se programan |
| `test_gate.py` | Dos adquisiciones del mismo dominio dentro de `min_spacing_s` → la segunda falla |
| Integración | Worker local (`wrangler dev`) + agente contra un servidor HTTP de fixtures |
