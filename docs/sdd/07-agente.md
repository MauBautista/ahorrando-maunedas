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
├── compose.snippet.yaml
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
│   │   ├── amazon_mx.py  walmart_mx.py  sams_mx.py  costco_mx.py
│   ├── images/remove_bg.py     # (E3)
│   └── health.py               # healthcheck del contenedor
└── tests/
    ├── fixtures/html/<adapter>/*.html   # páginas reales guardadas (spike B y fallos)
    ├── test_money.py  test_jsonld.py  test_adapters.py  test_scheduler.py  test_gate.py
```

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
    "blocked": ["walmart_mx"],               // adapters con listings bloqueados
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
  "config": { "min_spacing_s": { "amazon_mx": 45, "walmart_mx": 30, "sams_mx": 30, "costco_mx": 30, "default": 20 } }
}
```

Del lado del Worker:
- Actualiza `agent_status` (`last_heartbeat_at`, `agent_version`, `info`). Solo asigna nueva `version` (y por tanto baja a los clientes) si cambió `info.blocked`, si el agente estaba fuera de línea o si pasaron ≥ 10 min desde la última versión.
- Si el agente estaba fuera de línea y el watchdog había avisado, borra la marca para avisar de nuevo en la siguiente caída.

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

Estrategia común (`BaseAdapter.fetch`): HTTP → JSON-LD → estado embebido → selectores → Playwright. Cada paso registra `extra.method` para saber qué funciona.

Hipótesis iniciales por tienda — **se confirman o corrigen en el spike B (T-011)** con páginas guardadas como fixtures:

| Adapter | Dominios | Canónica e id | Fuente probable del precio | Notas |
|---|---|---|---|---|
| `amazon_mx` | `amazon.com.mx` (`amzn.to`, `a.co` se resuelven en el Worker) | `https://www.amazon.com.mx/dp/{ASIN}`; ASIN con `/(?:dp\|gp/product\|gp/aw/d)/([A-Z0-9]{10})` | Selectores del bloque de precio principal (`.a-offscreen` dentro del contenedor de precio), precio de lista en el bloque "Precio de lista"; disponibilidad en `#availability` | Separación 45 s. Detectar página de captcha. Guardar vendedor en `extra.seller` |
| `walmart_mx` | `walmart.com.mx` | Id numérico al final de la ruta `/ip/…/{id}` | JSON-LD `Product` o estado embebido del framework | Precio y stock dependen de la tienda: fijar CP `72750` |
| `sams_mx` | `sams.com.mx` | Id de producto de la ruta | Igual que Walmart (mismo grupo; posiblemente misma plataforma) | CP `72750`; algunos precios pueden requerir sesión de socio → si es así, `extra.member_only = true` |
| `costco_mx` | `costco.com.mx` | Código de producto en `/p/{code}` | JSON-LD u objeto de estado de la página | Verificar si el precio público requiere seleccionar almacén |

## 10. Respaldos (T-230)

| Trabajo | Cuándo | Qué hace |
|---|---|---|
| Espejo | Diario, `BACKUP_HOUR` | `backup/pull` incremental hasta `has_more=false`; aplica filas a `/data/backups/mirror.sqlite` (creado con las migraciones de `apps/api/migrations`, copiadas en la imagen) |
| Volcado | `BACKUP_WEEKDAY` | `sqlite3 mirror.sqlite .dump \| gzip > weekly/maunedas-YYYY-MM-DD.sql.gz`; conserva `BACKUP_KEEP_WEEKLY` |
| Fotos | Diario, después del espejo | `rclone sync r2:maunedas-images /data/backups/r2` con token de solo lectura |

Resultado de cada trabajo en `kv` y en `info` del siguiente `/work` (visible en W-22).

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

La versión de la imagen de Playwright y la del paquete `playwright` de Python deben coincidir. En E3 se agrega `--extra images` y se descarga el modelo de rembg durante el build.

```yaml
# agent/compose.snippet.yaml — pegar en el compose del servidor
services:
  maunedas-agent:
    build:
      context: ./ahorrando-maunedas
      dockerfile: agent/Dockerfile
    restart: unless-stopped
    env_file: ./ahorrando-maunedas/agent/.env
    volumes:
      - ./data/maunedas:/data
    mem_limit: 1500m          # ajustar con el spike B
    cpus: 1.5
    shm_size: 512m
    logging:
      driver: json-file
      options: { max-size: "10m", max-file: "3" }
```

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
