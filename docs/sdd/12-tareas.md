# 12 · Tareas

Cada tarea es implementable en una o pocas sesiones. Formato: **docs** que hay que leer · **depende de** · **hecho cuando** (criterios verificables). Estado: `[ ]` pendiente · `[~]` en curso · `[x]` hecha.

Orden sugerido para el MVP: Etapa 0 completa → backend base (T-020 a T-032) → Android base (T-100 a T-106) → funcionalidades en paralelo entre Android y web.

## Resumen

| Bloque | Tareas |
|---|---|
| Etapa 0 · Fundaciones | T-001 a T-007 |
| Etapa 0 · Spikes | T-010 a T-015 |
| Etapa 1 · Worker | T-020 a T-041 |
| Etapa 1 · Android | T-100 a T-126 |
| Etapa 1 · Web | T-160 a T-166 |
| Etapa 1 · Cierre | T-190 |
| Etapa 2 · Agente y tracking | T-200 a T-223 |
| Etapa 2 · Respaldos y cierre | T-230, T-231, T-290 |
| Etapa 3 | T-300 en adelante |

---

## Etapa 0 · Fundaciones

### [x] T-001 · Monorepo y documentos
- **Docs:** `CLAUDE.md` (estructura)
- **Depende de:** —
- **Hacer:** repositorio con `apps/api`, `apps/web`, `apps/android`, `packages/shared`, `packages/design-tokens`, `agent/`, `fixtures/`, `docs/`; `pnpm-workspace.yaml`; `.editorconfig`; `.gitignore` (incluye `agent/.env`, `*.jks`, `google-services.json` de prod, `.dev.vars`); commit de todos los documentos.
- **Hecho cuando:** `pnpm install` funciona en la raíz; el repositorio está en GitHub.

### [x] T-002 · Integración continua
- **Docs:** 11 §4
- **Depende de:** T-001
- **Hecho cuando:** el workflow corre en cada push y pasa con proyectos vacíos (un test trivial por componente).
- **Nota:** el job de Android no aplica el plugin `google-services` hasta T-100 (el `google-services.json` depende de T-004).

### [x] T-003 · Recursos de Cloudflare
- **Docs:** 03 §2
- **Depende de:** T-001
- **Hacer:** D1 `maunedas` y `maunedas-dev`; R2 `maunedas-images` y `maunedas-images-dev` (privados); Workers `maunedas` y `maunedas-dev` en `workers.dev`; secretos `IMAGE_URL_SECRET`, `AGENT_TOKEN_SHA256` por entorno; `env.dev` con sus propios `vars`, D1 y R2 (03 §2).
- **Hecho cuando:** `wrangler deploy --env dev` publica un Worker que responde en `https://maunedas-dev.<subdominio>.workers.dev`.
- **Resultado (2026-10-19):** cuenta propia de Maunedas (T35), `https://maunedas-dev.maunedas.workers.dev` y `https://maunedas.maunedas.workers.dev`; `IMAGE_URL_SECRET` en ambos. `AGENT_TOKEN_SHA256` se carga en T-201, cuando exista la ruta que lo usa.

### [~] T-004 · Firebase
- **Docs:** 02 §2
- **Depende de:** T-003 (para conocer el dominio)
- **Hacer:** dos proyectos (dev y prod, decisión T25), 02 §2.
- **Hecho cuando:** en cada proyecto: Email/Password y Google habilitados (sin bloquear el registro); dominio autorizado y URI de redirección `/__/auth/handler` del host de su Worker; apps Android (`.dev` en dev) con SHA-1/256 de debug; secreto `GOOGLE_SERVICE_ACCOUNT` del proyecto de dev cargado en `maunedas-dev`.
- **Avance (2026-10-20):** proyecto `maunedas-dev` con app web y app Android (`com.maubautista.maunedas.dev`, SHA del keystore de debug del servidor); `FIREBASE_PROJECT_ID` en `maunedas-dev`, `.env.development`/`.env.dev` de la web y Web client ID en `gradle.properties`; `GOOGLE_SERVICE_ACCOUNT` en `maunedas-dev` (2026-10-21, probada contra Identity Toolkit en el spike E). Verificado por API (2026-10-21): Email/contraseña y Google habilitados, registro sin bloquear, dominio autorizado, URI de redirección, SHA-1/256, FCM e Identity Toolkit habilitadas, API key restringida por sitio y `google-services.json` con clientes Android y web; secreto `GOOGLE_SERVICES_JSON_DEV` en GitHub. Confirmado a mano por Mauricio (2026-10-21): orígenes de JavaScript, *branding* publicado, restricción de APIs de la key y llave vieja de la cuenta de servicio borrada. **Dev completo**; falta el proyecto de prod.

### [ ] T-005 · OpenRouter
- **Docs:** 09 §2
- **Depende de:** T-003
- **Hecho cuando:** key exclusiva con límite mensual de 6 USD; secreto `OPENROUTER_API_KEY` en el Worker de dev.

### [x] T-006 · `packages/shared` base
- **Docs:** 04 §2, 09 §5–6, 10 §2.2, 02 §3, `ARQUITECTURA.md` §3.1
- **Depende de:** T-001
- **Hacer:** `pricing/units.ts`, `pricing/promotions.ts` (fórmulas y detección), `text/searchKey.ts`, `receipts/normalize.ts`, `receipts/abbreviations.ts`, `receipts/stores.ts`, `catalog/quantity.ts` (+ `suggestVariantLabel`), `auth/username.ts`, `util/uuid.ts` (v7 y v5 con namespaces fijos).
- **Hecho cuando:** Vitest pasa **todos** los fixtures de `fixtures/`.

### [x] T-007 · Tokens de diseño
- **Depende de:** T-001
- **Hacer:** `packages/design-tokens/tokens.json` (colores con modo claro/oscuro, tipografía, espaciado, radios, colores por fuente de precio: pagado, anaquel, web) + script que genera `apps/web/src/styles/tokens.css` y `core/designsystem/.../Tokens.kt`.
- **Hecho cuando:** el script corre en CI y ambos archivos generados están versionados.

## Etapa 0 · Spikes

### [ ] T-010 · Spike A: rembg en el servidor
- **Docs:** 11 §7 · **Decide:** D5
### [x] T-011 · Spike B: scraping de tiendas prioritarias
- **Docs:** 11 §7, 07 §9 · **Decide:** métodos por tienda, `mem_limit` · **Deja:** fixtures HTML en `agent/tests/fixtures/html/` · **Resultado:** `docs/spikes/spike-b-scraping.md`
### [ ] T-012 · Spike C: extracción de tickets
- **Docs:** 09 §9 · **Depende de:** T-003, T-005 · **Decide:** D2 y `AI_RECEIPT_MODEL`
### [x] T-013 · Spike D: CPU del Worker
- **Docs:** 11 §7 · **Depende de:** T-021, T-022, T-031 (versiones mínimas) · **Decide:** D3 · **Nota:** se ejecuta en la Etapa 1, justo después de T-031
- **Resultado (2026-10-19):** `docs/spikes/spike-d-cpu.md`. Token y firma de Google caben (p95 ≤ 4 ms); push p95 21–26 ms, pull p95 23 ms (13 ms con páginas de 100), vinculación ingenua p95 65 ms; ninguna petición cortada y el límite de 50 consultas no se aplicó. D3 → se queda en Free (T40).
### [x] T-014 · Spike E: correo sintético
- **Docs:** 02 §3, 11 §7 · **Depende de:** T-004 · **Decide:** D9
- **Resultado (2026-10-21):** `docs/spikes/spike-e-correo.md`. Los cuatro dominios funcionan; D9 → `maunedas.local` (T47). El login en Android quedó confirmado en T-110.
### [ ] T-015 · Cerrar decisiones
- **Depende de:** T-010 a T-014
- **Hecho cuando:** D2, D5 y D9 están en "Decisiones tomadas" de `ESTADO.md` con resultados de los spikes. D3 se cierra en T-013.

---

## Etapa 1 · Worker

### [x] T-020 · Esqueleto del Worker
- **Docs:** 03 §1–2
- **Depende de:** T-003, T-006
- **Hacer:** Hono, `ApiError` + `onError` (formato 03 §1.1), `X-Request-Id`, verificación de `X-Client-Schema`, `GET /v1/health`, `wrangler.jsonc` completo con assets, cron vacío.
- **Hecho cuando:** tests de formato de error, 426 y health pasan; deploy en dev.

### [x] T-021 · Middleware de autenticación y `/v1/me`
- **Docs:** 02 §5.1 · **Depende de:** T-020, T-026
- **Hecho cuando:** pasan los casos del middleware de 02 §9.
- **Resultado (2026-10-19):** 20 pruebas con JWKS local (firma, `iss`, `aud`, expiración, `alg: none`, `sub` vacío, identidad, Google verificado y no verificado, mayúsculas en el correo, inactivo, admin, llaves de Google inaccesibles → 502). La prueba con tokens reales de Firebase se hace en el spike E (T-014).

### [x] T-022 · Token de Google y `token_cache`
- **Docs:** 02 §5.2 · **Depende de:** T-020, T-026
- **Hecho cuando:** con `fetch` simulado se obtiene y cachea el token (memoria y D1); se renueva al vencer.
- **Resultado (2026-10-19):** 9 pruebas con `fetch` y reloj simulados y una cuenta de servicio desechable (firma y claims del JWT, caché en memoria y en D1, renovación un minuto antes, intercambio único con peticiones simultáneas, errores de Google y secreto ausente). Se prueba contra Google real cuando exista la cuenta de servicio (T-004).

### [x] T-023 · Administración de usuarios
- **Docs:** 02 §5.3, 03 §12 · **Depende de:** T-021, T-022
- **Hecho cuando:** `GET/POST/PATCH /v1/admin/users` y `/password` funcionan con Identity Toolkit simulado; `USERNAME_TAKEN`, `GOOGLE_EMAIL_TAKEN`, `LAST_ADMIN` y la compensación probados.
- **Resultado (2026-10-19):** las cuatro rutas con Identity Toolkit simulado; compensación ante fallas de D1 (también por carrera de `UNIQUE`), activación con reversión si Firebase falla a medias, borrado de identidades de Google al cambiar el correo (T45); 18 pruebas. Contra Firebase real se prueba al tener T-004.

### [x] T-024 · Bootstrap
- **Docs:** 02 §5.4 · **Depende de:** T-023
- **Hecho cuando:** los tres casos de 02 §9 pasan; se crea el admin real en dev.
- **Resultado (2026-10-19/21):** `POST /v1/bootstrap` con los tres casos de 02 §9 y la carrera entre dos bootstraps; 6 pruebas. Admin real `mau` creado en dev con `apps/api/scripts/bootstrap.sh` (contraseña y token solo en la terminal de Mauricio; el token se borró al terminar).

### [x] T-025 · Proxy de auth
- **Docs:** 02 §5.5 · **Depende de:** T-020
- **Hecho cuando:** `/__/auth/handler` en dev devuelve la página de Firebase (200) sin redirección.
- **Resultado (2026-10-21):** `auth/proxy.ts`; en `maunedas-dev`, `/__/auth/handler` responde 200 con el mismo contenido que `firebaseapp.com`; 6 pruebas. `init.json` da 404 también directo (no hay sitio de Hosting); el login con Google de la web (T-160) lo confirma.

### [x] T-026 · Esquema D1 y datos semilla
- **Docs:** `esquema-d1.sql` · **Depende de:** T-020
- **Hacer:** migración `0001_init.sql` escrita a mano a partir de `esquema-d1.sql` (si drizzle-kit no la reproduce fielmente: `COLLATE NOCASE`, índices parciales, `CHECK`, vista); Drizzle schema para consultas tipadas, con un test que compare contra `PRAGMA table_info`; script de semillas (tiendas de `PLAN.md`, categorías propuestas, `stores.adapter` para Amazon, Costco y Sam's; Walmart sin adapter).
- **Hecho cuando:** `wrangler d1 migrations apply` funciona local y en dev; `sync_meta` con `version` y `schema_version`.
- **Resultado (2026-10-19):** `migrations/0001_init.sql` copia de `esquema-d1.sql` (Drizzle 0.45 no tiene `COLLATE` en SQLite, así que `drizzle-kit` quedó fuera); `src/db/schema.ts` para consultas tipadas; `seeds/0001_lookups.sql` idempotente (13 tiendas, 15 categorías, IDs UUIDv7 fijos). `test/schema.test.ts` compara migraciones contra el diseño y Drizzle contra `PRAGMA table_info`, y prueba el prorrateo de `v_price_points`. Aplicado en local y en `maunedas-dev`; prod se migra con `deploy:prod`.

### [x] T-027 · Dispositivos
- **Docs:** 03 §5 · **Depende de:** T-021
- **Hecho cuando:** upsert por `device_id`, token duplicado se limpia del otro dispositivo, `DELETE` solo del dueño.
- **Resultado (2026-10-19):** 16 pruebas (alta, actualización, token movido, teléfono que cambia de dueño, web sin token, validación con Zod, borrado propio, ajeno e inexistente). Helper `parseJsonBody` con `details.issues` para todas las rutas.

### [x] T-030 · Registro de sync y esquemas de fila
- **Docs:** 04 §2 · **Depende de:** T-006, T-026
- **Hecho cuando:** `TABLES` cubre todas las tablas sync/down del esquema; cada tabla tiene Zod de fila; test que compara columnas del registro contra `PRAGMA table_info` de D1.
- **Resultado (2026-10-19):** registro de 21 tablas (17 sync, 4 down) y sus esquemas Zod; 88 pruebas contra D1 (cobertura, columnas, llaves, índices únicos parciales, orden padre→hijo por llaves foráneas, esquemas = columnas) y 16 de reglas de fila. Validaciones adicionales en 04 §2.2.

### [x] T-031 · Push
- **Docs:** 04 §3 · **Depende de:** T-030, T-021
- **Hecho cuando:** todos los casos de push de 04 §8 pasan.
- **Resultado (2026-10-19):** `POST /v1/sync/push` con 31 pruebas (LWW, reintento idéntico, empate de otro autor, clamp, columnas ausentes, `search_key` desde la fila combinada, validación, tablas desconocidas, duplicados, `MEASURE_LOCKED`, `BARCODE_TAKEN` y mover códigos, `ALIAS_TAKEN`, `IMMUTABLE_ROW`, los cuatro `FORBIDDEN`, padres faltantes en cascada, `BATCH_REJECTED`, límites). El registro declara las llaves foráneas (`refs`), verificadas contra D1. Cambios al algoritmo en 04 §3.2.

### [x] T-032 · Pull
- **Docs:** 04 §4 · **Depende de:** T-030
- **Hecho cuando:** casos de pull de 04 §8 pasan, incluido el cursor compuesto con 1,200 filas de la misma versión.
- **Resultado (2026-10-19):** `POST /v1/sync/pull` con 14 pruebas (desde cero, cursores, tombstones, 1,200 filas de la misma versión en páginas de 500, fila editada entre páginas, filtro por usuario de reglas y eventos, columnas de `users`, `tables`, validación).

### [x] T-033 · Catálogo (consulta)
- **Docs:** 03 §7 · **Depende de:** T-031
- **Hecho cuando:** `lookups`, `products` (búsqueda sin acentos, categorías con subcategorías, paginación), `products/:id` y `search/variants` con tests.
- **Resultado (2026-10-19):** las cuatro rutas, mejor precio por unidad (03 §3) y `ImageRef` con URLs firmadas (firma de 10 §3 adelantada de T-037); 16 pruebas de catálogo y 4 de firma.

### [x] T-034 · Historial y comparador
- **Docs:** 03 §7, `ARQUITECTURA.md` §3.3 · **Depende de:** T-033
- **Hacer:** `prorateTicketDiscount` en `packages/shared` con su sección de fixture (prorrateo del descuento de ticket, `esquema-d1.sql` → `v_price_points`).
- **Hecho cuando:** `variants/:id/history` y `products/:id/compare` devuelven valores que coinciden con `fixtures/normalizacion.json` y con el prorrateo; "mejor precio" según 03 §3.
- **Resultado (2026-10-19):** `prorateTicketDiscount` y `effectiveUnitCents` con la sección `prorrateo_ticket` (6 casos); migración `0002_price_points_guard.sql` para que la vista no divida entre cero ni dé precios negativos (T41); historial y comparador con la misma regla de mejor precio que la lista; rutas separadas por recurso como en 03 §2. La vista de D1 pasa el fixture; 10 pruebas de API y 4 de la regla compartida. La versión Kotlin va en T-101 y la `@DatabaseView` de Room en T-102, con el mismo fixture.

### [x] T-035 · Compras (consulta)
- **Docs:** 03 §7 · **Depende de:** T-031
- **Hecho cuando:** lista paginada con filtros y detalle con líneas, promociones e imágenes de ticket.
- **Resultado (2026-10-19):** `GET /v1/purchases` (filtros por fecha, tienda y estado; cursor opaco que desempata compras a la misma hora) y `GET /v1/purchases/:id` (líneas con producto y precio por unidad con el cupón prorrateado, también en borradores; promociones de la compra y de sus líneas vivas; páginas del ticket con URLs firmadas); 9 pruebas.

### [x] T-036 · Códigos de barras y catálogo abierto
- **Docs:** 10 §2 · **Depende de:** T-031
- **Hecho cuando:** casos de lookup de 10 §7 pasan.
- **Resultado (2026-10-19):** `GET /v1/barcodes/:code` con coincidencia propia, caché positiva (30 días) y negativa (7 días), orden OFF → OBF → OPF, User-Agent, mapeo de 10 §2.1 y manejo de fallas sin caché negativa falsa (T42); 13 pruebas con `fetch` simulado. Forma de la respuesta verificada contra la API real de Open Food Facts.

### [x] T-037 · Imágenes: subida, descarga, firma, importación
- **Docs:** 10 §3–4, 10 §2.3 · **Depende de:** T-031
- **Hecho cuando:** casos de PUT, firma e importación de 10 §7 pasan; `ImageRef` se arma con URLs firmadas.
- **Nota:** `signPath`/`verifySigned` e `imageRefs` ya existen (T-033); falta servir y recibir los binarios.
- **Resultado (2026-10-19):** `PUT`/`GET /v1/images/:imageId/blobs/:name` (dueño de la clave verificado en D1, solo tiers `device`/`manual`, primera subida gana, firma o Bearer, `ETag`/`304`) y `POST /v1/images/:imageId/import` (hosts permitidos también tras redirecciones, sin credenciales, ≤ 10 MB contado al leer, `image/*`); 16 pruebas. `IMAGE_URL_SECRET` existe en dev y prod.

### [x] T-038 · Fusión (admin)
- **Docs:** 03 §12 · **Depende de:** T-031
- **Hecho cuando:** caso de fusión de 11 §3 pasa para `variant` y `product`; `MERGE_INVALID` probado.
- **Resultado (2026-10-19):** `POST /v1/admin/merge` en un solo batch con versión nueva para cada fila tocada; ligas de etiquetas unidas sin duplicados vivos (crea o revive el uuidv5 del destino); imágenes y foto principal pasan al destino (T44); 9 pruebas, incluida una que compara las tablas movidas con las llaves foráneas de D1.

### [x] T-039 · Gateway de IA y presupuesto
- **Docs:** 09 §1–2 · **Depende de:** T-020, T-026
- **Hecho cuando:** `monthWindow` probado en el cambio de mes; `assertBudget` y registro de `ai_usage`; `GET /v1/admin/ai-budget` con `soft_limit_reached`; marca del 80 % una vez por mes (el push al admin llega con T-213).
- **Resultado (2026-10-25):**
  - **`apps/api/src/ai/`:** tipos, proveedor de OpenRouter con salida `json_schema` y costo real, `runAi` con presupuesto, reintento y cobro de cada respuesta, y el presupuesto con `monthWindow` (UTC−6), el tope en micro-dólares y la marca del 80 % una vez al mes.
  - **`GET /v1/admin/ai-budget`** con gasto por propósito, número de llamadas y `soft_limit_reached`.
  - Probado con un OpenRouter simulado: no necesita la key. Las pruebas usan una key falsa, así que la de `.dev.vars` nunca llega a una prueba.
  - 9 pruebas (T68).

### [ ] T-040 · Extracción de tickets
- **Docs:** 09 §3–7 · **Depende de:** T-037, T-039, T-012
- **Hecho cuando:** con proveedor simulado: conversión y advertencias (09 §4.4), reutilización por `images_key`, 402/409/422/429/503, coincidencias por alias y código, sugerencias con `score`, detección de promociones y tienda. La vinculación preselecciona candidatos por SQL (≤ 50) y su CPU se mide en `maunedas-dev` (spike D: puntuar contra todo el catálogo cuesta p95 65 ms).

### [x] T-041 · Cron de mantenimiento
- **Docs:** 03 §2 · **Depende de:** T-022
- **Hecho cuando:** limpia `token_cache`, `off_cache` vencido e `image_jobs` viejos a las 04:07 hora de México (probado con reloj simulado).
- **Resultado (2026-10-19):** `cron/maintenance.ts` llamado desde el `scheduled` real; hora por zona horaria; `image_jobs` terminados con más de 30 días; 3 pruebas con `createScheduledController`.

---

## Etapa 1 · Android

### [~] T-100 · Proyecto y módulos
- **Docs:** 05 §1–2 · **Depende de:** T-001, T-004
- **Hecho cuando:** módulos creados con dependencias permitidas, catálogo de versiones, Hilt, sabores `dev`/`prod` con `API_BASE_URL`, `GOOGLE_WEB_CLIENT_ID` y `SYNTHETIC_EMAIL_DOMAIN`, `google-services.json` por sabor (escrito en CI desde `GOOGLE_SERVICES_JSON_DEV`), build en CI.
- **Avance (2026-10-20):** los 20 módulos de 05 §2 con plugins de convención, `checkModuleDependencies` (probado con tres dependencias prohibidas), catálogo completo, Hilt + Compose en la app, sabores con los tres `BuildConfig` y el paso de CI que escribe `google-services.json` si existe el secreto (el plugin se probó con un archivo falso). Dev completo (2026-10-21): `google-services.json`, secreto de CI y Web client ID. Falta el sabor `prod` (su `google-services.json` y su Web client ID) cuando exista el proyecto de prod.

### [x] T-101 · `core:model` y `core:pricing`
- **Docs:** 05 §6 · **Depende de:** T-100, T-006
- **Hecho cuando:** Kotlin pasa **todos** los fixtures (tarea de Gradle que los copia a recursos de prueba).
- **Resultado (2026-10-21):** las reglas de 05 §6 en Kotlin pasan los seis fixtures (incluido `prorrateo_ticket`) con la tarea `copyFixtures`; 24 pruebas en 9 suites. Nueve mutaciones (redondeo a par, `nxm`, normalización de tickets, bits de v5, tope del cupón, acentos, NFKC, detección, coma decimal) hacen fallar una prueba; la de NFKC necesitó una prueba propia porque `usuarios.json` no la cubre.

### [x] T-102 · `core:database`
- **Docs:** 04 §6.1 · **Depende de:** T-100, T-030
- **Hecho cuando:** entidades espejo de las tablas sync/down, tablas locales, vista `v_price_points`, DAOs; test que compara nombres de columna con el registro de sync; esquema de Room exportado. La vista de Room pasa `normalizacion.json` → `prorrateo_ticket`, como la de D1 (T41).
- **Resultado (2026-10-21):** 21 entidades espejo + `outbox`, `pending_uploads`, `sync_cursors`, `sync_issues`; `v_price_points`; DAOs; esquema exportado. Contrato `packages/shared/sync-schema.json` (registro + `esquema-d1.sql`) y 8 pruebas con Robolectric: columnas, tipos y nulabilidad contra el contrato, SQL de la vista idéntico al de D1, fixture de prorrateo y orden del outbox (T48).

### [x] T-103 · `core:network`
- **Docs:** 02 §6.3, 03 §1 · **Depende de:** T-100
- **Hecho cuando:** Retrofit con los DTOs de E1, `AuthInterceptor`, `TokenAuthenticator`, errores mapeados a `ApiException(code)`; tests con MockWebServer (401 → refresco → reintento una vez).
- **Resultado (2026-10-21):** `MaunedasApi` (me, devices, push, pull, códigos, subida e importación de imágenes; los de tickets llegan con T-040), `MaunedasJson`, `AuthInterceptor`/`TokenAuthenticator` sobre `IdTokenProvider`, errores por `CallAdapter` (`ApiException`, `UpgradeRequiredException`, `HTTP_ERROR` si el cuerpo no es del Worker; la red caída sigue siendo `IOException`); 12 pruebas con MockWebServer (T49).

### [x] T-104 · `core:sync`
- **Docs:** 04 §6 · **Depende de:** T-102, T-103, T-031, T-032
- **Hecho cuando:** `LocalWriter`, `SyncWorker`, `PullApplier`, `ConflictHandler` y la programación de 04 §6.6; casos de Android de 04 §8 pasan.
- **Resultado (2026-10-22):** `SyncTables` (contra el contrato), `LocalWriter` con las cascadas de 04 §6.2, `SyncEngine` (push en lotes de 100, padres primero, división ante `BATCH_REJECTED`/413, pull por páginas), `PullApplier`, `ConflictHandler`, `SyncWorker`, `SyncScheduler`, `ForegroundSync`; 22 pruebas con Robolectric y MockWebServer, incluidos los tres casos de Android de 04 §8 (T50). La app conecta WorkManager con Hilt en T-110.

### [x] T-105 · `UploadWorker`
- **Docs:** 10 §4.2 · **Depende de:** T-104, T-037
- **Hecho cuando:** caso de `UploadWorker` de 10 §7 pasa.
- **Resultado (2026-10-22):** `UploadEngine`, `UploadQueue`, `UploadWorker` y su programación; el caso de 10 §7 (espera a que la fila salga del outbox, 409 reintenta, 201 limpia) más 413/415, importaciones, archivo faltante y sesión vencida; 10 pruebas nuevas (T51).

### [x] T-106 · Sistema de diseño
- **Docs:** 05 §7 · **Depende de:** T-007, T-100
- **Hecho cuando:** tema claro/oscuro desde tokens; `MoneyField`, `QuantityField`, `StorePicker`, `VariantSearchField`, `PriceText` (con precio por unidad) con previews y prueba de fuente al 200 %.
- **Resultado (2026-10-22):** tema y colores extendidos desde tokens (más `tokens_colors.xml` generado), los cinco componentes con previews, `Money`/`Quantities` en `core:model`, ícono adaptativo y tema de ventana claro/oscuro; 5 pruebas de Compose con Robolectric (incluida la de fuente al 200 % que detecta textos cortados) y 4 de dinero; lint sin avisos (T52).

### [x] T-110 · Login y sesión
- **Docs:** 02 §6 · **Depende de:** T-103, T-021, T-027
- **Hecho cuando:** usuario/contraseña y Google funcionan contra dev; mensajes de 02 §8; sesión offline; cierre de sesión con advertencia de pendientes. Incluye confirmar el correo sintético `@maunedas.local` con el SDK de Android (pendiente del spike E), y conectar en la app `IdTokenProvider` y `CurrentUser` (Firebase), `ApiConfig`/`ClientInfo`, `HiltWorkerFactory` para WorkManager, `ForegroundSync` y `schedulePeriodic` al iniciar sesión (T-103, T-104).
- **Resultado (2026-10-22):** `core:auth`, pantalla S-01, Inicio provisional con cierre de sesión, app conectada (Firebase, WorkManager con Hilt, sync al entrar); 10 pruebas (ViewModel con mensajes de 02 §8, `LoginFinisher` con MockWebServer, cierre de sesión que borra todo, sesión). Probado en un Pixel 8 Pro (Android 17) contra dev: contraseña incorrecta, login con `mau@maunedas.local` (cierra el spike E), arranque sin red, cierre de sesión (borra el dispositivo) y Google; el sync quedó en 200 cada 60 s en primer plano. La prueba encontró que el pull mandaba `"tables": null` y el Worker respondía 400 (PR #40, T53).

### [x] T-111 · Inicio (S-02)
- **Depende de:** T-110, T-104
- **Resultado (2026-10-22):**
  - S-02 con las cuatro acciones, el gasto del mes (hora de la Ciudad de México), las cinco compras recientes con su chip "Borrador", avisos de borradores y de cambios rechazados, e indicador de pendientes.
  - Barra inferior de 05 §4; Ajustes provisional con sync y cierre de sesión.
  - `core:data` (`PurchaseRepository`, `SyncHealthRepository`) y `core:ui` (fechas en español, `ComingSoon`).
  - 18 pruebas: consultas de Room, meses de la Ciudad de México, fechas (12 y 24 horas) y pantalla, incluida la de fuente al 200 %, ahora sin el falso positivo de desborde (T54).
  - Revisado en un Pixel 8 Pro: Inicio, pestañas, Atrás a Inicio y la hora en el formato del teléfono.
### [x] T-112 · Catálogo (S-07)
- **Depende de:** T-104, T-106, T-101 · **Hecho cuando:** búsqueda local sin acentos, filtros por categoría (con subcategorías) y etiqueta, mejor precio por unidad por tarjeta.
- **Resultado (2026-10-22):**
  - Búsqueda y filtros con la misma sentencia que `GET /v1/products`: palabras con AND y coincidencia parcial, código exacto de 6 a 14 dígitos, subcategorías por CTE recursivo y etiqueta. Paginado con Paging 3 sobre Room.
  - Mejor precio con `BestPrices` (`core:pricing`), la regla de `pickBest`. Muestra el valor por unidad con el punto de su fuente, la presentación, la tienda y la antigüedad.
  - Con los datos de `apps/api/test/catalog.test.ts` da los mismos resultados que la API.
  - 19 pruebas: regla del mejor precio, repositorio con los datos de la API, pantalla (incluida la fuente al 200 %), antigüedad y `UnitPriceText`.
  - Miniatura pospuesta a T-117 (T55).
### [x] T-113 · Editor de producto y variante (S-09, S-10)
- **Depende de:** T-112 · **Hecho cuando:** asistente de contenido guarda unidades base correctas; códigos múltiples; borrado solo para admin.
- **Resultado (2026-10-22):**
  - `CatalogEditor` (`core:data`) guarda producto, etiquetas (alta rápida; las que ya existen se reutilizan sin importar mayúsculas), `product_tags` con UUIDv5 (quitar y volver a poner revive la misma fila), presentación y códigos en una transacción con `LocalWriter`.
  - Un código que ya es de otra presentación no deja guardar nada y dice de cuál es.
  - Asistente `[paquete] × [cantidad] [unidad]` a unidades base (`Content`, `core:pricing`); etiqueta sugerida con `suggestVariantLabel` que sigue al contenido hasta que se escribe otra; "a granel" solo con masa (1 kg, paquete de 1).
  - Eliminar producto o presentación solo para admin, con las cascadas de 04 §6.2.
  - 25 pruebas: asistente de contenido, repositorio de edición con Room, formularios y pantallas (incluida la fuente al 200 %). Decisiones de flujo en T56.
### [x] T-114 · Ficha: presentaciones y comparador (S-08)
- **Depende de:** T-113 · **Hecho cuando:** valores iguales a `GET /v1/products/:id/compare` con los mismos datos.
- **Incluye (T56):** que la tarjeta del catálogo abra la ficha (hoy abre el editor) y, para el admin, la fusión que ofrece RF-CAT-03 cuando un código ya es de otra presentación.
- **Resultado (2026-10-22):**
  - Ficha con encabezado (marca, ruta de categoría, etiquetas), acciones y pestañas.
  - "Presentaciones": contenido, códigos y último precio por tienda y fuente.
  - "Comparar": último, mínimo y promedio de 90 días, con el más barato resaltado.
  - Con los datos de `apps/api/test/prices.test.ts` da las mismas filas, orden y mejor precio que `/compare`.
  - Fusión de admin de productos y presentaciones con llamada directa (T57), también desde un código repetido en S-10.
  - La tarjeta del catálogo ya abre la ficha.
  - 19 pruebas: regla del comparador, ficha sobre Room con los datos de la API, fusión con MockWebServer y pantallas (incluida la fuente al 200 % en ambas pestañas).
### [x] T-115 · Ficha: historial
- **Depende de:** T-114 · **Hecho cuando:** gráfica Vico con puntos por fuente y filtros.
- **Resultado (2026-10-22):**
  - Pestaña "Historial" con Vico 3.3.1: un color por fuente, solo puntos, x por día de la Ciudad de México.
  - Filtros por presentación, fuente, periodo (3 meses, 1 año por omisión, todo) y tienda.
  - Debajo, la lista de precios del más nuevo al más viejo con "Con promoción"; la gráfica tiene una descripción para lectores de pantalla.
  - Con los datos de la prueba de historial de la API da los mismos puntos: cupón prorrateado, solo confirmadas, otra medida en su unidad.
  - 9 pruebas (T58).
### [x] T-116 · Escáner y resultado (S-11, S-12)
- **Depende de:** T-113, T-036 · **Hecho cuando:** los cuatro caminos de S-12 funcionan, incluido sin red.
- **Incluye (T56):** el botón "Escanear código" del editor de presentación (S-10); hoy los códigos se escriben a mano (`source = 'manual'`).
- **Resultado (2026-10-24):**
  - **Cámara (`core:camera`):** CameraX 1.6.2 con ML Kit 17.3.0 (modelo incluido, sin red), formatos de S-11, linterna, vibración y tono. El mismo código se ignora 2 s mientras siga a la vista. Se puede escribir el código si la etiqueta no se lee o no hay permiso de cámara.
  - **Los cuatro caminos de S-12 (`ScanRepository`):** encontrado aquí, con últimos precios; en el servidor, con pull y espera a que baje; en un catálogo abierto, que prellena "Nuevo producto"; y desconocido o sin red, con el código ya asignado. En los dos últimos se pregunta "¿Es otra presentación de un producto que ya tienes?".
  - **Desde "Encontrado":** "Agregar a la compra abierta" abre el borrador más reciente con la línea lista.
  - **Códigos leídos:** se guardan con `source = 'scan'`.
  - **S-10 "Escanear código" (T56):** una hoja de lectura única con el permiso incluido (`ScanCodeSheet`); el código pasa por las mismas revisiones que uno escrito.
  - 15 pruebas: lectura y filtro de 2 s, `ScanRepository` con Room y MockWebServer, ViewModel en los cuatro caminos (incluido el pull pedido), pantalla con letra al 200 % y prellenado (T62).
### [x] T-117 · Foto de producto e importación del catálogo (S-18)
- **Depende de:** T-105, T-116
- **Nota (T-125):** `LocalPhotos` (reducir y guardar, 10 §4.2) y `rememberTakePhoto` (app de cámara con permiso) ya existen; falta la galería.
- **Resultado (2026-10-24):**
  - **Sección "Foto" en S-09:** cámara, galería y quitar. La foto se guarda con el producto como su `primary_image_id`, y la anterior recibe tombstone.
  - **Catálogo abierto:** la foto se importa al guardar un producto creado desde el escáner, con licencia y atribución.
  - **Miniaturas en el catálogo y foto grande en la ficha:** Coil 3 con la sesión; primero el archivo del teléfono, en el orden de 10 §1.
  - **Probado en un Galaxy A53 (Android 16):**
    - Foto con la cámara: en R2 quedó un JPEG de 1153 × 2048, sin EXIF, y reemplazó a la anterior.
    - Después de "Liberar espacio", la miniatura bajó del Worker con la sesión.
    - La foto de Open Food Facts se importó al guardar una leche.
  - **Corregido en la prueba:**
    - Coil guardaba el 404 de una foto que aún no se importaba. Ahora solo guarda fotos, y no se pide una imagen que sigue en la cola.
    - Ajustes no recalculaba "Fotos guardadas en el teléfono" al volver (de T-126).
  - 11 pruebas nuevas, más el prellenado de la foto en la prueba de formularios (T65).
- **Incluye (T62):** la foto del catálogo abierto al crear un producto desde el escáner (`image_url` ya llega en `CatalogGuess`).
- **Incluye:** la miniatura de la tarjeta del catálogo (Coil 3 con el `AuthInterceptor`, archivo local primero, prioridad de 10 §1), pospuesta de T-112 (T55).
### [ ] T-118 · Recorte en el teléfono (opcional)
- **Docs:** 10 §5 · **Depende de:** T-117

### [x] T-120 · Lista de compras (S-03)
- **Depende de:** T-104
- **Resultado (2026-10-22):**
  - Lista paginada (Paging 3 sobre Room), de la más nueva a la más vieja, agrupada por día de la Ciudad de México ("Hoy", "Ayer", "martes 20 de octubre").
  - Cada compra con tienda · sucursal, hora, productos, total (sin total de ticket, la regla de Inicio) y "Borrador".
  - Filtros: tienda (las que tienen compras), fechas (este mes, mes pasado, últimos 3 meses o días elegidos) y estado.
  - Mensajes distintos para "sin compras" y "sin coincidencias".
  - "Nueva compra" y tocar una compra abren la ruta del editor, que llega con T-121 (T59).
  - 13 pruebas.
### [x] T-121 · Editor de compra y de línea (S-04, S-05)
- **Docs:** 05 §5, 09 §6.1 · **Depende de:** T-120, T-112, T-101
- **Hecho cuando:** promociones calculadas según fixtures, a granel, descuentos de ticket, validación del total, borrado en cascada (04 §6.2), autoguardado.
- **Resultado (2026-10-23):**
  - **`PurchaseEditor` (`core:data`):** guarda en una transacción la compra (`discount_cents` = Σ descuentos de ticket), sus líneas renumeradas con `final = bruto − descuento`, una promoción por línea (parámetros en JSON; MSI con `affects_price = 0`) y una por descuento de ticket. Lo que se quita queda borrado con sus cascadas.
  - **Formulario de línea (S-05):** con todos los casos de `promociones.json` da lo esperado; el granel es en kilos con 3 decimales (0.845 kg × $32.90 = $27.80) y una rebaja escrita a mano queda como `other`.
  - **Confirmar y salir:** pide tienda y un producto, y pregunta si el total no cuadra por más de $1.00. El borrador se guarda al salir o al pasar la app a segundo plano, una sola vez aunque coincidan.
  - **Selector de tienda (S-14):** por uso reciente, con búsqueda y alta de tienda y sucursal; la ciudad sale de la última sucursal usada o Puebla.
  - **Pantalla:** quitar con deslizar o botón y "Deshacer"; fecha y hora en la Ciudad de México.
  - 24 pruebas: aritmética de la compra, repositorio sobre Room (incluida la vista de precios con el cupón prorrateado), formulario con los fixtures, ViewModel con Room en memoria y pantallas con letra al 200 % (T60).
### [x] T-122 · Escaneo continuo en compra
- **Depende de:** T-121, T-116
- **Nota (T-116):** `BarcodeScanner(onCode, paused)` ya filtra el mismo código 2 s; en modo continuo cada lectura agrega una línea sin pausar la cámara.
- **Resultado (2026-10-24):**
  - **"Escanear productos" en S-04:** la cámara no se pausa. Cada código que ya está aquí agrega una línea al último precio de esa tienda y enfoca su precio. La misma presentación sin promoción suma una pieza (hallazgo frente a RF-COM-09, T64).
  - **Códigos que no están aquí:** si el servidor los tiene, se bajan. Si no, "Darlo de alta" abre S-12 para ese código. En ambos casos la línea se agrega sola cuando llega.
  - **Confirmar** rechaza líneas sin precio.
  - **Probado en un Galaxy A53 (Android 16):** la misma presentación sumó una pieza, se enfocó el precio, y un código del catálogo abierto se dio de alta y volvió solo a la compra. La prueba mostró lecturas falsas con poca luz; ahora un código cuenta al leerse dos veces en menos de 1 s, y los códigos en espera se pueden quitar.
  - **Corrección:** tres textos de compras (`editor_delete`, `editor_back`, `editor_save`) se llamaban igual que en catálogo, así que en la app uno pisaba al otro y se mostraba "Eliminar" en vez de "Eliminar compra". Se renombraron, y `StringNamesTest` falla si dos módulos repiten un nombre.
  - 12 pruebas.
### [x] T-123 · Foto de ticket (escáner de documentos)
- **Depende de:** T-121, T-105
- **Nota (T-125):** `LocalPhotos.Size.RECEIPT` ya reduce a 1600 px JPEG 80 (10 §4.2).
- **Resultado (2026-10-24):**
  - **"Foto de ticket" en S-04 y en Inicio:** escáner de documentos de ML Kit con 1 a 4 páginas; si no está disponible, la app de cámara. Pide la tienda primero.
  - **Las páginas se guardan al tomarlas:** el borrador se guarda primero y cada página queda en la cola de subida. Se pueden quitar.
  - **Probado en un Galaxy A53:** el ticket de Sam's Club se recortó a 488 × 1600 y llegó a R2 sin EXIF. La ✕ sobre la miniatura tapaba el ticket y se movió abajo.
  - 7 pruebas (T66).
### [ ] T-124 · Revisión de ticket (S-06)
- **Incluye (T60):** reordenar las líneas de S-04 (hoy quedan en el orden en que se capturan) y "Vincular" en las líneas sin vincular.
- **Avance (2026-10-24, T67):** ya están "Ordenar" (↑↓, y "Subir"/"Bajar" con TalkBack), "Vincular" y los alias al confirmar (09 §7.4).
  - Falta lo que depende de la extracción (spike C y la key de OpenRouter): "Extraer", S-06 y los códigos del ticket (§7.5).
  - 6 pruebas.
- **Docs:** 09 §7 · **Depende de:** T-123, T-040, T-101
- **Hecho cuando:** estados de línea, aceptar sugerencia, crear producto desde una línea, confirmar crea compra + alias + códigos; segunda compra se vincula sola.
### [x] T-125 · Precio de anaquel (S-13)
- **Depende de:** T-121
- **Nota (T-116):** `ShelfPriceDestination(variantId)` ya existe y la abre "Precio de anaquel" del escáner y de Inicio; hoy muestra "llega pronto".
- **Resultado (2026-10-24):**
  - **S-13 (`feature:shelf`):** variante (la del escáner, búsqueda por palabras o código, o "Escanear código"), tienda y sucursal (mis últimas de anaquel), precio, promoción opcional y foto opcional. "Guardar y otro" conserva la tienda y la sucursal. Inicio abre S-13 sin variante.
  - **Precio efectivo (`ShelfPrices`, `core:pricing`):** lo que cuesta una pieza con la promoción, a la cantidad mínima que la activa (2x1 → dos), con las fórmulas de S-05. MSI no cambia el precio.
  - **Guardado (`ShelfRepository`):** la observación `shelf` con la hora actual, su fila de `promotions` (`observation_id`) y la imagen `shelf_photo`, en una transacción. La foto queda en la cola de subida.
  - **Fotos (`LocalPhotos`, `rememberTakePhoto`):** la app de cámara del teléfono, reducción de 10 §4.2 con el giro de EXIF aplicado y sin EXIF en la copia. Quedan listas para T-117 y T-123.
  - **Compartido con S-05:** el selector de promociones y las hojas de tienda y sucursal pasaron a `core:ui`.
  - 18 pruebas (T63).
### [x] T-126 · Ajustes y sincronización (S-15 a S-17)
- **Depende de:** T-104, T-110 · **Hecho cuando:** estado de sync, "Sincronizar ahora", cambios rechazados y diálogo `BARCODE_TAKEN` con sus dos opciones.
- **Resultado (2026-10-23):**
  - **S-15:** cuenta con cambiar contraseña, resumen de sync, fotos en el teléfono con "Liberar espacio" (conserva las que faltan por subir), versión y esquema, y cerrar sesión.
  - **S-16:** última sincronización (sobrevive a reabrir la app), pendientes por tabla, fotos por subir, último error y "Cambios rechazados" con nombre, motivo en español y "Entendido".
  - **S-17:** el diálogo del código repetido aparece sobre cualquier pantalla. "Usar esa presentación" mueve lo propio (compras, precios de anaquel, enlaces, alertas propias, alias, fotos) y borra mi código; "Mantener separado" solo borra mi código.
  - Snackbar "Otro dispositivo actualizó «…»".
  - 12 pruebas: estado persistente, `SyncCenter` sobre Room (pendientes, rechazos, ambas opciones del código, liberar espacio) y pantallas con letra al 200 % (T61).

---

## Etapa 1 · Web

### [ ] T-160 · Esqueleto web
- **Docs:** 06 §1–4, 06 §6–7, 02 §7 · **Depende de:** T-020, T-025, T-007, T-004, T-021
- **Hecho cuando:** login con ambos métodos (incluido Safari de iPhone vía proxy), layout responsive, cliente HTTP, despliegue junto con el Worker.
- **Avance (2026-10-25, T69):**
  - Router, sesión con `GET /v1/me`, login con usuario o Google, armazón responsive, cliente HTTP con reintento en 401, Cuenta con "Cerrar sesión", manifiesto e íconos.
  - Desplegado en `maunedas-dev`.
  - 13 pruebas con Firebase y `fetch` falsos.
  - Falta probar el login real en el navegador del teléfono y en Safari de iPhone.
### [ ] T-161 · Catálogo y ficha web (W-07 a W-09)
- **Depende de:** T-160, T-033, T-034
### [ ] T-162 · Compras web (W-03 a W-05)
- **Depende de:** T-160, T-035
### [ ] T-163 · Tickets web (W-06)
- **Depende de:** T-162, T-040, T-037
### [ ] T-164 · Precio de anaquel y escaneo web (W-10)
- **Depende de:** T-161, T-036
### [ ] T-165 · Administración web (W-11 a W-13)
- **Depende de:** T-160, T-023, T-038, T-039
### [ ] T-166 · Cuenta (W-14)
- **Depende de:** T-160

## Etapa 1 · Cierre

### [ ] T-190 · Cierre de la Etapa 1
- **Docs:** 11 §5, `PLAN.md`
- **Hecho cuando:** checklist 11 §5 completo; dos semanas de uso real de los cuatro usuarios; `ESTADO.md` actualizado.

---

## Etapa 2 · Agente y tracking

### [ ] T-200 · Proyecto del agente
- **Docs:** 07 §2–4, 07 §12–13 · **Depende de:** T-011, T-201 (el healthcheck necesita `/work`)
- **Hecho cuando:** contenedor corre en el servidor, SQLite local creada, logs JSON, healthcheck.
### [ ] T-201 · `/agent/v1` auth y `/work`
- **Docs:** 07 §5.1 · **Depende de:** T-026
- **Hacer:** generar `AGENT_TOKEN` (en `agent/.env` y en el gestor de contraseñas) y cargar su hash con `wrangler secret put AGENT_TOKEN_SHA256` en dev y prod.
- **Hecho cuando:** token por hash, respuesta de 07 §5.1, `agent_status` con la regla de versión cada 10 min.
### [ ] T-202 · Scheduler, gate y outbox del agente
- **Docs:** 07 §7 · **Depende de:** T-200, T-201
- **Hecho cuando:** `test_scheduler.py` y `test_gate.py` pasan; ningún resultado se pierde al cortar la red.
### [ ] T-203 · HTTP, JSON-LD, estado embebido y dinero
- **Docs:** 07 §8.1, 8.3, 8.4 · **Depende de:** T-200
### [ ] T-204 · Navegador (Playwright)
- **Docs:** 07 §8.2 · **Depende de:** T-203
- **Hecho cuando:** reinicio por número de páginas y por memoria probado.
### [ ] T-205 · Adapter `amazon_mx` · [ ] T-207 · `sams_mx` · [ ] T-208 · `costco_mx`
- **Docs:** 07 §9, `docs/spikes/spike-b-scraping.md` · **Depende de:** T-203 (ninguna requirió navegador en el spike B)
- **T-206 · `walmart_mx`: descartada (2026-10-19).** Walmart bloquea con captcha de PerimeterX desde la primera petición; por la regla 10 no se sigue (decisión T34).
- **Hecho cuando:** fixtures `ok`, `sin stock`, `con precio de lista` y `bloqueo` pasan; una URL real devuelve el precio correcto para CP 72750.
### [ ] T-210 · Resolver URL, revisar ahora, listar listings
- **Docs:** 03 §11 · **Depende de:** T-031
- **Hecho cuando:** enlaces cortos de Amazon resueltos solo con `Location`; URL no soportada → 422.
### [ ] T-211 · Ingesta de observaciones
- **Docs:** 07 §6 · **Depende de:** T-201
- **Hecho cuando:** compresión por cambio, idempotencia por `checked_at`, fallas consecutivas, transición a `blocked`.
### [ ] T-212 · Motor de alertas
- **Docs:** 08 §2–5, 03 §11 · **Depende de:** T-211
- **Hacer:** incluye `GET /v1/alerts/events`.
- **Hecho cuando:** tabla de 08 §8 (casos 1–11) pasa.
### [ ] T-213 · Entrega FCM y avisos de sistema
- **Docs:** 08 §6 · **Depende de:** T-212, T-022, T-027
- **Hecho cuando:** caso 12 de 08 §8 pasa; avisos de sistema al admin.
### [ ] T-214 · Watchdog del agente
- **Docs:** 08 §5, 07 §5.1, 03 §12 · **Depende de:** T-213
- **Hacer:** incluye `GET /v1/admin/agent`.
### [ ] T-220 · Android: agregar URL y listings (S-20, S-21)
- **Depende de:** T-210, T-126 · **Hecho cuando:** compartir desde la app de Amazon crea el listing.
### [ ] T-221 · Android: reglas, historial de alertas, FCM y deep link (S-22, S-23)
- **Docs:** 08 §7 · **Depende de:** T-213, T-220
### [ ] T-222 · Android: serie web escalonada y estado del agente
- **Nota (T-115):** hoy la serie web se dibuja como puntos, igual que las otras; esta tarea la convierte en escalones hasta `web_confirmed_until`.
- **Depende de:** T-115, T-211
### [ ] T-223 · Web: seguimiento, alertas y agente (W-20 a W-22)
- **Depende de:** T-210, T-212, T-161

## Etapa 2 · Respaldos y cierre

### [ ] T-230 · Respaldos
- **Docs:** 07 §5.4, 07 §10 · **Depende de:** T-200, T-201, T-032
- **Hacer:** incluye la ruta `POST /agent/v1/backup/pull` en el Worker.
### [ ] T-231 · Prueba de restauración
- **Hecho cuando:** procedimiento y resultado en `ESTADO.md` (RF-BAK-04).
### [ ] T-290 · Cierre de la Etapa 2
- **Docs:** 11 §6

---

## Etapa 3 (se detallará al iniciarla)

| ID | Tarea | Docs |
|---|---|---|
| T-300 | Mejora de fotos en casa (rembg) y adopción automática | 07 §11, 10 §6.1 |
| T-301 | Editor de fotos Android y web | 10 §6.2 |
| T-302 | Edición generativa con IA | 10 §6.3 |
| T-303 | OCR local experimental | 09 §3 |
| T-304 | Correos: compartir a la app y lectura de Gmail desde el agente | `ARQUITECTURA.md` §15 |
| T-305 | Adapter Mercado Libre (API oficial) y más tiendas | 07 §9 |
| T-306 | Importación CSV/Excel | — |
| T-307 | Importación CFDI/XML | — |
| T-308 | API de lectura para Home Assistant | — |
| T-309 | Métricas del agente en InfluxDB/Grafana | — |
| T-310 | PWA offline | — |
