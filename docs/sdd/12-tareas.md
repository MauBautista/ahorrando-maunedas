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

### [ ] T-001 · Monorepo y documentos
- **Docs:** `CLAUDE.md` (estructura)
- **Depende de:** —
- **Hacer:** repositorio con `apps/api`, `apps/web`, `apps/android`, `packages/shared`, `packages/design-tokens`, `agent/`, `fixtures/`, `docs/`; `pnpm-workspace.yaml`; `.editorconfig`; `.gitignore` (incluye `agent/.env`, `*.jks`, `google-services.json` de prod, `.dev.vars`); commit de todos los documentos.
- **Hecho cuando:** `pnpm install` funciona en la raíz; el repositorio está en GitHub.

### [ ] T-002 · Integración continua
- **Docs:** 11 §4
- **Depende de:** T-001
- **Hecho cuando:** el workflow corre en cada push y pasa con proyectos vacíos (un test trivial por componente).

### [ ] T-003 · Recursos de Cloudflare
- **Docs:** 03 §2
- **Depende de:** T-001
- **Hacer:** D1 `maunedas` y `maunedas-dev`; R2 `maunedas-images` (privado); Workers `maunedas` y `maunedas-dev` en `workers.dev`; secretos `IMAGE_URL_SECRET`, `AGENT_TOKEN_SHA256`.
- **Hecho cuando:** `wrangler deploy --env dev` publica un Worker que responde en `https://maunedas-dev.<subdominio>.workers.dev`.

### [ ] T-004 · Firebase
- **Docs:** 02 §2
- **Depende de:** T-003 (para conocer el dominio)
- **Hecho cuando:** Email/Password y Google habilitados; dominios autorizados y URI de redirección `/__/auth/handler` configurados; SHA-1/256 de debug registrados; secreto `GOOGLE_SERVICE_ACCOUNT` cargado en el Worker de dev.

### [ ] T-005 · OpenRouter
- **Docs:** 09 §2
- **Hecho cuando:** key exclusiva con límite mensual de 6 USD; secreto `OPENROUTER_API_KEY` en el Worker de dev.

### [ ] T-006 · `packages/shared` base
- **Docs:** 04 §2, 09 §5–6, 10 §2.2, 02 §3, `ARQUITECTURA.md` §3.1
- **Depende de:** T-001
- **Hacer:** `pricing/units.ts`, `pricing/promotions.ts` (fórmulas y detección), `text/searchKey.ts`, `receipts/normalize.ts`, `receipts/abbreviations.ts`, `receipts/stores.ts`, `catalog/quantity.ts` (+ `suggestVariantLabel`), `auth/username.ts`, `util/uuid.ts` (v7 y v5 con namespaces fijos).
- **Hecho cuando:** Vitest pasa **todos** los fixtures de `fixtures/`.

### [ ] T-007 · Tokens de diseño
- **Hacer:** `packages/design-tokens/tokens.json` (colores con modo claro/oscuro, tipografía, espaciado, radios, colores por fuente de precio: pagado, anaquel, web) + script que genera `apps/web/src/styles/tokens.css` y `core/designsystem/.../Tokens.kt`.
- **Hecho cuando:** el script corre en CI y ambos archivos generados están versionados.

## Etapa 0 · Spikes

### [ ] T-010 · Spike A: rembg en el servidor
- **Docs:** 11 §7 · **Decide:** D5
### [ ] T-011 · Spike B: scraping de tiendas prioritarias
- **Docs:** 11 §7, 07 §9 · **Decide:** métodos por tienda, `mem_limit` · **Deja:** fixtures HTML en `agent/tests/fixtures/html/`
### [ ] T-012 · Spike C: extracción de tickets
- **Docs:** 09 §9 · **Decide:** D2 y `AI_RECEIPT_MODEL`
### [ ] T-013 · Spike D: CPU del Worker
- **Docs:** 11 §7 · **Depende de:** T-021, T-022, T-031 (versiones mínimas) · **Decide:** D3
### [ ] T-014 · Spike E: correo sintético
- **Docs:** 02 §3, 11 §7 · **Depende de:** T-004 · **Decide:** D9
### [ ] T-015 · Cerrar decisiones
- **Hecho cuando:** D2, D3, D5 y D9 están en "Decisiones tomadas" de `ESTADO.md` con resultados de los spikes.

---

## Etapa 1 · Worker

### [ ] T-020 · Esqueleto del Worker
- **Docs:** 03 §1–2
- **Depende de:** T-003, T-006
- **Hacer:** Hono, `ApiError` + `onError` (formato 03 §1.1), `X-Request-Id`, verificación de `X-Client-Schema`, `GET /v1/health`, `wrangler.jsonc` completo con assets, cron vacío.
- **Hecho cuando:** tests de formato de error, 426 y health pasan; deploy en dev.

### [ ] T-021 · Middleware de autenticación y `/v1/me`
- **Docs:** 02 §5.1 · **Depende de:** T-020, T-026
- **Hecho cuando:** pasan los casos del middleware de 02 §9.

### [ ] T-022 · Token de Google y `token_cache`
- **Docs:** 02 §5.2 · **Depende de:** T-020, T-026
- **Hecho cuando:** con `fetch` simulado se obtiene y cachea el token (memoria y D1); se renueva al vencer.

### [ ] T-023 · Administración de usuarios
- **Docs:** 02 §5.3, 03 §12 · **Depende de:** T-021, T-022
- **Hecho cuando:** `GET/POST/PATCH /v1/admin/users` y `/password` funcionan con Identity Toolkit simulado; `USERNAME_TAKEN`, `GOOGLE_EMAIL_TAKEN`, `LAST_ADMIN` y la compensación probados.

### [ ] T-024 · Bootstrap
- **Docs:** 02 §5.4 · **Depende de:** T-023
- **Hecho cuando:** los tres casos de 02 §9 pasan; se crea el admin real en dev.

### [ ] T-025 · Proxy de auth
- **Docs:** 02 §5.5 · **Depende de:** T-020
- **Hecho cuando:** `/__/auth/handler` en dev devuelve la página de Firebase (200) sin redirección.

### [ ] T-026 · Esquema D1 y datos semilla
- **Docs:** `esquema-d1.sql` · **Depende de:** T-020
- **Hacer:** Drizzle schema fiel al SQL; migración `0001_init.sql`; script de semillas (tiendas de `PLAN.md`, categorías propuestas, `stores.adapter` para Amazon, Costco, Walmart y Sam's).
- **Hecho cuando:** `wrangler d1 migrations apply` funciona local y en dev; `sync_meta` con `version` y `schema_version`.

### [ ] T-027 · Dispositivos
- **Docs:** 03 §5 · **Depende de:** T-021
- **Hecho cuando:** upsert por `device_id`, token duplicado se limpia del otro dispositivo, `DELETE` solo del dueño.

### [ ] T-030 · Registro de sync y esquemas de fila
- **Docs:** 04 §2 · **Depende de:** T-006, T-026
- **Hecho cuando:** `TABLES` cubre todas las tablas sync/down del esquema; cada tabla tiene Zod de fila; test que compara columnas del registro contra `PRAGMA table_info` de D1.

### [ ] T-031 · Push
- **Docs:** 04 §3 · **Depende de:** T-030, T-021
- **Hecho cuando:** todos los casos de push de 04 §8 pasan.

### [ ] T-032 · Pull
- **Docs:** 04 §4 · **Depende de:** T-030
- **Hecho cuando:** casos de pull de 04 §8 pasan, incluido el cursor compuesto con 1,200 filas de la misma versión.

### [ ] T-033 · Catálogo (consulta)
- **Docs:** 03 §7 · **Depende de:** T-031
- **Hecho cuando:** `lookups`, `products` (búsqueda sin acentos, categorías con subcategorías, paginación), `products/:id` y `search/variants` con tests.

### [ ] T-034 · Historial y comparador
- **Docs:** 03 §7, `ARQUITECTURA.md` §3.3 · **Depende de:** T-033
- **Hecho cuando:** `variants/:id/history` y `products/:id/compare` devuelven valores que coinciden con `fixtures/normalizacion.json`; "mejor precio" según 03 §3.

### [ ] T-035 · Compras (consulta)
- **Docs:** 03 §7 · **Depende de:** T-031
- **Hecho cuando:** lista paginada con filtros y detalle con líneas, promociones e imágenes de ticket.

### [ ] T-036 · Códigos de barras y catálogo abierto
- **Docs:** 10 §2 · **Depende de:** T-031
- **Hecho cuando:** casos de lookup de 10 §7 pasan.

### [ ] T-037 · Imágenes: subida, descarga, firma, importación
- **Docs:** 10 §3–4, 10 §2.3 · **Depende de:** T-031
- **Hecho cuando:** casos de PUT, firma e importación de 10 §7 pasan; `ImageRef` se arma con URLs firmadas.

### [ ] T-038 · Fusión (admin)
- **Docs:** 03 §12 · **Depende de:** T-031
- **Hecho cuando:** caso de fusión de 11 §3 pasa para `variant` y `product`; `MERGE_INVALID` probado.

### [ ] T-039 · Gateway de IA y presupuesto
- **Docs:** 09 §1–2 · **Depende de:** T-020, T-026
- **Hecho cuando:** `monthWindow` probado en el cambio de mes; `assertBudget` y registro de `ai_usage`; `GET /v1/admin/ai-budget`; aviso al 80 % una vez por mes (con envío simulado).

### [ ] T-040 · Extracción de tickets
- **Docs:** 09 §3–7 · **Depende de:** T-037, T-039, T-012
- **Hecho cuando:** con proveedor simulado: conversión y advertencias (09 §4.4), reutilización por `images_key`, 402/409/422/429/503, coincidencias por alias y código, sugerencias con `score`, detección de promociones y tienda.

### [ ] T-041 · Cron de mantenimiento
- **Docs:** 03 §2 · **Depende de:** T-022
- **Hecho cuando:** limpia `token_cache`, `off_cache` vencido e `image_jobs` viejos a las 04:07 hora de México (probado con reloj simulado).

---

## Etapa 1 · Android

### [ ] T-100 · Proyecto y módulos
- **Docs:** 05 §1–2 · **Depende de:** T-001, T-004
- **Hecho cuando:** módulos creados con dependencias permitidas, catálogo de versiones, Hilt, sabores `dev`/`prod` con `API_BASE_URL` y `GOOGLE_WEB_CLIENT_ID`, build en CI.

### [ ] T-101 · `core:model` y `core:pricing`
- **Docs:** 05 §6 · **Depende de:** T-100, T-006
- **Hecho cuando:** Kotlin pasa **todos** los fixtures (tarea de Gradle que los copia a recursos de prueba).

### [ ] T-102 · `core:database`
- **Docs:** 04 §6.1 · **Depende de:** T-100, T-030
- **Hecho cuando:** entidades espejo de las tablas sync/down, tablas locales, vista `v_price_points`, DAOs; test que compara nombres de columna con el registro de sync; esquema de Room exportado.

### [ ] T-103 · `core:network`
- **Docs:** 02 §6.3, 03 §1 · **Depende de:** T-100
- **Hecho cuando:** Retrofit con los DTOs de E1, `AuthInterceptor`, `TokenAuthenticator`, errores mapeados a `ApiException(code)`; tests con MockWebServer (401 → refresco → reintento una vez).

### [ ] T-104 · `core:sync`
- **Docs:** 04 §6 · **Depende de:** T-102, T-103, T-031, T-032
- **Hecho cuando:** `LocalWriter`, `SyncWorker`, `PullApplier`, `ConflictHandler` y la programación de 04 §6.6; casos de Android de 04 §8 pasan.

### [ ] T-105 · `UploadWorker`
- **Docs:** 10 §4.2 · **Depende de:** T-104, T-037
- **Hecho cuando:** caso de `UploadWorker` de 10 §7 pasa.

### [ ] T-106 · Sistema de diseño
- **Docs:** 05 §7 · **Depende de:** T-007, T-100
- **Hecho cuando:** tema claro/oscuro desde tokens; `MoneyField`, `QuantityField`, `StorePicker`, `VariantSearchField`, `PriceText` (con precio por unidad) con previews y prueba de fuente al 200 %.

### [ ] T-110 · Login y sesión
- **Docs:** 02 §6 · **Depende de:** T-103, T-021
- **Hecho cuando:** usuario/contraseña y Google funcionan contra dev; mensajes de 02 §8; sesión offline; cierre de sesión con advertencia de pendientes.

### [ ] T-111 · Inicio (S-02)
- **Depende de:** T-110, T-104
### [ ] T-112 · Catálogo (S-07)
- **Depende de:** T-104, T-106 · **Hecho cuando:** búsqueda local sin acentos, filtros por categoría (con subcategorías) y etiqueta, mejor precio por unidad por tarjeta.
### [ ] T-113 · Editor de producto y variante (S-09, S-10)
- **Depende de:** T-112 · **Hecho cuando:** asistente de contenido guarda unidades base correctas; códigos múltiples; borrado solo para admin.
### [ ] T-114 · Ficha: presentaciones y comparador (S-08)
- **Depende de:** T-113 · **Hecho cuando:** valores iguales a `GET /v1/products/:id/compare` con los mismos datos.
### [ ] T-115 · Ficha: historial
- **Depende de:** T-114 · **Hecho cuando:** gráfica Vico con puntos por fuente y filtros.
### [ ] T-116 · Escáner y resultado (S-11, S-12)
- **Depende de:** T-113, T-036 · **Hecho cuando:** los cuatro caminos de S-12 funcionan, incluido sin red.
### [ ] T-117 · Foto de producto e importación del catálogo (S-18)
- **Depende de:** T-105, T-116
### [ ] T-118 · Recorte en el teléfono (opcional)
- **Docs:** 10 §5 · **Depende de:** T-117

### [ ] T-120 · Lista de compras (S-03)
- **Depende de:** T-104
### [ ] T-121 · Editor de compra y de línea (S-04, S-05)
- **Docs:** 05 §5, 09 §6.1 · **Depende de:** T-120, T-112
- **Hecho cuando:** promociones calculadas según fixtures, a granel, descuentos de ticket, validación del total, borrado en cascada (04 §6.2), autoguardado.
### [ ] T-122 · Escaneo continuo en compra
- **Depende de:** T-121, T-116
### [ ] T-123 · Foto de ticket (escáner de documentos)
- **Depende de:** T-121, T-105
### [ ] T-124 · Revisión de ticket (S-06)
- **Docs:** 09 §7 · **Depende de:** T-123, T-040
- **Hecho cuando:** estados de línea, aceptar sugerencia, crear producto desde una línea, confirmar crea compra + alias + códigos; segunda compra se vincula sola.
### [ ] T-125 · Precio de anaquel (S-13)
- **Depende de:** T-121
### [ ] T-126 · Ajustes y sincronización (S-15 a S-17)
- **Depende de:** T-104, T-110 · **Hecho cuando:** estado de sync, "Sincronizar ahora", cambios rechazados y diálogo `BARCODE_TAKEN` con sus dos opciones.

---

## Etapa 1 · Web

### [ ] T-160 · Esqueleto web
- **Docs:** 06 §1–4, 06 §6–7, 02 §7 · **Depende de:** T-020, T-025, T-007
- **Hecho cuando:** login con ambos métodos (incluido Safari de iPhone vía proxy), layout responsive, cliente HTTP, despliegue junto con el Worker.
### [ ] T-161 · Catálogo y ficha web (W-07 a W-09)
- **Depende de:** T-160, T-033, T-034
### [ ] T-162 · Compras web (W-03 a W-05)
- **Depende de:** T-160, T-035
### [ ] T-163 · Tickets web (W-06)
- **Depende de:** T-162, T-040, T-037
### [ ] T-164 · Precio de anaquel y escaneo web (W-10)
- **Depende de:** T-161
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
- **Docs:** 07 §2–4, 07 §12–13 · **Depende de:** T-011
- **Hecho cuando:** contenedor corre en el servidor, SQLite local creada, logs JSON, healthcheck.
### [ ] T-201 · `/agent/v1` auth y `/work`
- **Docs:** 07 §5.1 · **Depende de:** T-026
- **Hecho cuando:** token por hash, respuesta de 07 §5.1, `agent_status` con la regla de versión cada 10 min.
### [ ] T-202 · Scheduler, gate y outbox del agente
- **Docs:** 07 §7 · **Depende de:** T-200, T-201
- **Hecho cuando:** `test_scheduler.py` y `test_gate.py` pasan; ningún resultado se pierde al cortar la red.
### [ ] T-203 · HTTP, JSON-LD, estado embebido y dinero
- **Docs:** 07 §8.1, 8.3, 8.4 · **Depende de:** T-200
### [ ] T-204 · Navegador (Playwright)
- **Docs:** 07 §8.2 · **Depende de:** T-203
- **Hecho cuando:** reinicio por número de páginas y por memoria probado.
### [ ] T-205 · Adapter `amazon_mx` · [ ] T-206 · `walmart_mx` · [ ] T-207 · `sams_mx` · [ ] T-208 · `costco_mx`
- **Docs:** 07 §9 · **Depende de:** T-203 (y T-204 si la tienda lo requiere)
- **Hecho cuando:** fixtures `ok`, `sin stock`, `con precio de lista` y `bloqueo` pasan; una URL real devuelve el precio correcto para CP 72750.
### [ ] T-210 · Resolver URL, revisar ahora, listar listings
- **Docs:** 03 §11 · **Depende de:** T-031
- **Hecho cuando:** enlaces cortos de Amazon resueltos solo con `Location`; URL no soportada → 422.
### [ ] T-211 · Ingesta de observaciones
- **Docs:** 07 §6 · **Depende de:** T-201
- **Hecho cuando:** compresión por cambio, idempotencia por `checked_at`, fallas consecutivas, transición a `blocked`.
### [ ] T-212 · Motor de alertas
- **Docs:** 08 §2–5 · **Depende de:** T-211
- **Hecho cuando:** tabla de 08 §8 (casos 1–11) pasa.
### [ ] T-213 · Entrega FCM y avisos de sistema
- **Docs:** 08 §6 · **Depende de:** T-212, T-022, T-027
- **Hecho cuando:** caso 12 de 08 §8 pasa; avisos de sistema al admin.
### [ ] T-214 · Watchdog del agente
- **Docs:** 08 §5, 07 §5.1 · **Depende de:** T-213
### [ ] T-220 · Android: agregar URL y listings (S-20, S-21)
- **Depende de:** T-210, T-126 · **Hecho cuando:** compartir desde la app de Amazon crea el listing.
### [ ] T-221 · Android: reglas, historial de alertas, FCM y deep link (S-22, S-23)
- **Docs:** 08 §7 · **Depende de:** T-213, T-220
### [ ] T-222 · Android: serie web escalonada y estado del agente
- **Depende de:** T-115, T-211
### [ ] T-223 · Web: seguimiento, alertas y agente (W-20 a W-22)
- **Depende de:** T-210, T-212, T-161

## Etapa 2 · Respaldos y cierre

### [ ] T-230 · Respaldos
- **Docs:** 07 §5.4, 07 §10 · **Depende de:** T-200, T-032
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
