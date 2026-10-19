# ESTADO — Ahorrando Maunedas

**Última actualización:** 2026-10-19
**Etapa actual:** 0 — Fundaciones (con el backend de la Etapa 1 avanzando). Hito 1, SDD v1.1, T-003, T-020 a T-022, T-026, T-027, T-030 a T-033 y spikes B y D hechos; faltan Firebase, OpenRouter y los spikes A, C y E.

## Hecho
- Requisitos cerrados (sesiones de preguntas del 2026-09-30).
- Cambio de implementación: **Cloudflare como núcleo**, servidor casero como trabajador.
- `docs/ARQUITECTURA.md` y `docs/esquema-d1.sql` v0 (validado en SQLite: vista de precios, LWW, cursores, índices únicos parciales).
- `fixtures/` con vectores de normalización, promociones, textos (búsqueda y tickets), cantidades de catálogo y usuarios; todos verificados contra implementaciones de referencia.
- **SDD v1** en `docs/sdd/` con requisitos, contratos, diseño por módulo, pruebas y tareas `T-xxx`.
- **Hito 1 (2026-10-08):** repositorio público https://github.com/MauBautista/ahorrando-maunedas (T-001); CI con jobs `ts`, `android` y `agent` en cada push y PR (T-002); `packages/shared` con las reglas compartidas pasando los 6 fixtures, 113 pruebas (T-006); tokens de diseño que generan `tokens.css` y `Tokens.kt`, con prueba de contraste AA (T-007).
- Entorno verificado: la máquina de desarrollo es el servidor casero; workerd (`wrangler dev` y tests del Worker) corre bien en su CPU.
- **SDD v1.1** fusionado (2026-10-08).
- **T-003 (2026-10-19):** cuenta de Cloudflare propia de Maunedas; D1 `maunedas` y `maunedas-dev`, R2 `maunedas-images` y `maunedas-images-dev`; Workers en https://maunedas.maunedas.workers.dev y https://maunedas-dev.maunedas.workers.dev; `IMAGE_URL_SECRET` en ambos. wrangler usa el perfil `maunedas` ligado al repo (la sesión de booth360 sigue en el perfil `default`).
- **T-020 (2026-10-19):** Worker con Hono, formato de error de 03 §1.1, `X-Request-Id`, `X-Client-Schema`, `GET /v1/health`, cron vacío y `wrangler.jsonc` completo; 15 pruebas en workerd; desplegado en dev y prod (health, 426, 404 y SPA verificados por HTTPS).
- **T-011 · spike B (2026-10-19):** ver "Resultados de spikes".
- **T-026 (2026-10-19):** migración `0001_init.sql` (copia fiel de `esquema-d1.sql`), esquema de Drizzle para consultas tipadas, semillas idempotentes (13 tiendas, 15 categorías) y `/v1/health` leyendo `sync_meta`; aplicado en local y en `maunedas-dev`. Pruebas: el esquema migrado coincide con el diseño, Drizzle coincide con la base y `v_price_points` prorratea el cupón de ticket.
- **T-021 (2026-10-19):** middleware `requireUser` y `GET /v1/me`; 20 pruebas con JWKS local (casos de 02 §9 y bordes como `alg: none`, `sub` vacío, mayúsculas en el correo de Google y llaves de Google inaccesibles → 502). Falta probar con tokens reales en el spike E.
- **T-022 (2026-10-19):** token de servicio de Google con caché en memoria y en `token_cache`, renovación un minuto antes de vencer e intercambio único con peticiones simultáneas; 9 pruebas con `fetch` simulado. Falta probarlo contra Google con la cuenta de servicio real (T-004).
- **T-027 (2026-10-19):** `POST`/`DELETE /v1/devices` con DTO Zod compartido; un token FCM repetido se limpia del otro dispositivo y un teléfono que cambia de manos pasa al nuevo usuario; 16 pruebas.
- **T-030 (2026-10-19):** registro de tablas de sync (21 tablas) y esquemas Zod de fila en `packages/shared`, verificados contra el `PRAGMA` de D1 (incluido el orden padre→hijo por llaves foráneas).
- **T-031 (2026-10-19):** `POST /v1/sync/push` (LWW por fila, reintento idéntico, clamp, conflictos `STALE`, `VALIDATION`, `BARCODE_TAKEN`, `ALIAS_TAKEN`, `IMMUTABLE_ROW`, `FORBIDDEN`, `UNKNOWN_TABLE`, padres verificados antes del lote); 31 pruebas y seis mutaciones detectadas.
- **T-032 (2026-10-19):** `POST /v1/sync/pull` con cursor compuesto `(version, pk)` por tabla en un solo batch; 1,200 filas de la misma versión se paginan sin saltos ni repeticiones; reglas y eventos de alerta filtrados por usuario; 14 pruebas.
- **T-033 (2026-10-19):** consultas de catálogo para la web (`lookups`, lista de productos con búsqueda sin acentos, subcategorías, etiquetas, cursor y mejor precio por unidad; ficha con etiquetas, códigos y últimos precios; búsqueda de variantes) y URLs firmadas de imágenes; 20 pruebas.

## En curso
- Mauricio: Firebase (dos proyectos, hosts `maunedas-dev.maunedas.workers.dev` y `maunedas.maunedas.workers.dev`) y OpenRouter (T-004, T-005); 10 fotos para el spike A.

## Siguiente
1. T-034 a T-036 (historial y comparador con prorrateo, compras y códigos de barras) y T-038 (fusión), que no dependen de Firebase; luego T-023 y T-024 (usuarios y bootstrap) con Identity Toolkit simulado.
2. Spike A (rembg) en cuanto estén las 10 fotos; T-005.
3. Hito 3: T-004, spike E (primero de los que dependen de Firebase) y spike C (tickets).
4. Spike D (T-013) justo después de T-031; ahí se cierra D3.

## Decisiones tomadas

| # | Decisión | Motivo |
|---|---|---|
| T1 | Cloudflare (Worker + D1 + R2) es el sistema; el servidor casero solo hace trabajo pesado con conexiones salientes | App y web no dependen de la casa; nada expuesto a internet |
| T2 | Android nativo (Kotlin/Compose/Room); iPhone usa la web responsive | Offline obligatorio en Android; evitar una segunda app nativa |
| T3 | Web React + TS + Vite servida por el mismo Worker (Static Assets) | Sin SSR ni SEO; un solo deploy |
| T4 | D1 como única base central; SQLite local en el agente para su cola y el espejo de respaldo | Volumen de 4 usuarios; sin Postgres ni InfluxDB |
| T5 | Producto conceptual → variantes → códigos; marca distinta = producto distinto | Comparar presentaciones del mismo producto |
| T6 | Dinero en centavos INTEGER; tiempos epoch ms UTC; IDs UUIDv7 del cliente | Exactitud y creación offline |
| T7 | Sync por outbox + push/pull con versión del servidor, LWW por fila, tombstones, cursores `(version, id)` | Simple y suficiente para 4 usuarios |
| T8 | Datos escritos por el servidor en tablas separadas (`listing_state`, `alert_events`, `agent_status`) o filas append-only (`image_renditions`) | Que LWW nunca mezcle autores |
| T9 | Observaciones web solo se guardan cuando cambia precio, stock o promo | Ahorra escrituras y almacenamiento |
| T10 | Alertas evaluadas en el Worker al ingerir observaciones web; entrega por FCM | Una sola lógica |
| T11 | Agente en Python (httpx → JSON-LD/estado embebido → Playwright como último recurso) | rembg y Playwright nativos en Python; mínimo uso de Chromium |
| T12 | IA: proveedor intercambiable por variable de entorno; la key solo vive en el Worker; tope de 6 USD/mes (contabilidad en D1 + límite en la key) | Control de gasto y portabilidad |
| T13 | Fotos en 4 niveles: catálogo abierto → ML Kit en el teléfono → rembg en casa → IA a petición | Gratis y offline primero |
| T14 | Tickets: escáner de documentos (hasta 4 páginas) + alias aprendidos por tienda | La vinculación mejora con el uso sin costo |
| T15 | Nombre del proyecto: **Ahorrando Maunedas** | — |
| T16 | **Auth (antes D1):** Firebase Auth con dos métodos: **usuario + contraseña** (el usuario se traduce a un correo sintético) y **Google**. Sin registro público: el admin da de alta a cada usuario; Google solo entra si su correo está registrado | Pedido explícito; Firebase evita guardar contraseñas y no gasta CPU del Worker en hashing |
| T17 | **Dominio (antes D4):** el que da Cloudflare, `maunedas.<subdominio>.workers.dev`. Worker renombrado a `maunedas` | No se compra dominio |
| T18 | Consecuencia de T17: la importación de correos (etapa 3) **no** usará Email Routing (requiere dominio propio); se hará con la API de Gmail desde el agente o compartiendo el correo a la app | Sin dominio no hay Email Workers |
| T19 | Login con Google en web mediante proxy de `/__/auth/*` en el Worker (`authDomain` = el propio host) | Safari/iPhone bloquea almacenamiento de terceros |
| T20 | **Zona (antes D8):** código postal de referencia **72750**; comercios de Puebla, Cholula y alrededores | Precios web de Walmart, Sam's y Costco dependen de ubicación |
| T21 | **Por defecto (antes D6):** `applicationId` `com.maubautista.maunedas`; distribución por Firebase App Distribution; tokens de diseño en `packages/design-tokens/tokens.json` generando CSS y Kotlin | Cambiables antes del primer release |
| T22 | **Por defecto (antes D7):** permisos admin/miembro según ARQUITECTURA §11 | Validar con la familia en uso real |
| T23 | Respaldo semanal = volcado comprimido del espejo SQLite local (sin wrangler en el agente) | Menos dependencias en el contenedor |
| T24 | Android `minSdk 26`; UI con tamaños táctiles ≥ 48 dp y soporte de fuente grande | Teléfonos de toda la familia |
| T25 | **Dos proyectos de Firebase** (dev y prod) | Desactivar, borrar o compensar cuentas en dev nunca toca las cuentas de la familia |
| T26 | Repositorio **público** `MauBautista/ahorrando-maunedas`; una rama y un PR por tarea, fusión con squash cuando CI pasa | Decisión de Mauricio; minutos de Actions sin límite; nada secreto en el repo (gitleaks antes del primer push) |
| T27 | Toolchain fijado: Node 24 LTS; pnpm 12 con catálogo, versiones exactas y `minimumReleaseAge` de 1 día; **TypeScript 6.0.3** (typescript-eslint aún no admite 7); **Vitest 4.1.11** (el plugin de Workers exige ^4.1); Gradle 9.8.1, AGP 9.4.1 con Kotlin integrado (KGP 2.4.20), compile/targetSdk 37 | Versiones verificadas el 2026-10-08 y compatibles entre sí |
| T28 | Tests del Worker con `@cloudflare/vitest-plugin` (`vitest-pool-workers` está deprecado) | Nombre nuevo del paquete oficial |
| T29 | Paquetes `api`, `web`, `@maunedas/shared`, `@maunedas/design-tokens`; `shared` se consume como TS fuente sin build | Los filtros de `CLAUDE.md` funcionan omitiendo el scope; un paso de build menos |
| T30 | Namespaces UUIDv5 fijos (04 §2.1) y `fixtures/ids.json` | Que TS y Kotlin generen el mismo id para alias y etiquetas |
| T31 | `roundHalfUp(x) = floor(x + 0.5)` en TS y Kotlin; descuentos de promoción acotados a `[0, bruto]`; `detectPromotion` devuelve `null` con texto vacío | Paridad exacta entre lenguajes; contrato completo |
| T32 | `Tokens.kt` solo con primitivos hasta T-106; paleta inicial verde con fuentes de precio verde azulado (pagado), ámbar (anaquel) y azul (web) | Sin depender de Compose todavía; colores distinguibles para daltonismo, cambiables en `tokens.json` |
| T33 | Bucket R2 `maunedas-images-dev` aparte; en Firebase **no** se desactiva el registro de usuarios | Pruebas de dev fuera de los respaldos de prod; bloquear el registro rompe el primer login con Google (el Worker ya rechaza cuentas no vinculadas) |
| T34 | **Walmart sale del tracker web** (G6 y RF-TRK-01 actualizados; T-206 descartada). Sigue como tienda física para compras, anaquel y tickets | Spike B: bloquea con captcha de PerimeterX desde la primera petición HTTP; la regla 10 prohíbe evadirlo. Decisión de Mauricio, 2026-10-19 |
| T35 | Cuenta de Cloudflare **propia de Maunedas**, subdominio `maunedas.workers.dev` (URLs `maunedas.maunedas.workers.dev` y `maunedas-dev.maunedas.workers.dev`); wrangler con el perfil de autenticación `maunedas` ligado a este repo | No compartir con booth360 los límites del plan Free ni el cobro, y un nombre propio. Decisión de Mauricio, 2026-10-19 |
| T36 | Agente: Amazon, Sam's y Costco por HTTP (selectores, JSON-LD, `__NEXT_DATA__`), Playwright solo como último recurso; `mem_limit: 1200m`; `selectolax.lexbor` | Spike B: ninguna tienda necesitó navegador; pico de Chromium 759 MB |
| T37 | Migraciones D1 escritas a mano (`apps/api/migrations/`), `esquema-d1.sql` como esquema acumulado verificado por prueba; Drizzle solo para consultas tipadas (sin `drizzle-kit`); semillas en `apps/api/seeds/` con IDs fijos e `INSERT OR IGNORE`; `deploy:dev`/`deploy:prod` migran antes de desplegar | Drizzle 0.45 no expresa `COLLATE NOCASE` en SQLite; semillas repetibles sin duplicar ni pisar ediciones; que nunca se despliegue código sobre una base sin migrar |
| T38 | Esquemas de fila: obligatorias las columnas `NOT NULL` sin default, opcionales las demás (las columnas nuevas siempre opcionales); validaciones adicionales en 04 §2.2 (intervalo de 1 h a 7 días, granel, UUIDv5 verificados, alias normalizado, longitudes) | Clientes con esquema anterior no rompen el push; datos inválidos se rechazan con `VALIDATION` antes de llegar a D1 |
| T39 | Push: la fila se valida combinada con la existente (y `search_key` se deriva de ella); las llaves foráneas se verifican antes del lote y un padre faltante rechaza solo esa fila (`MISSING_PARENT`, en cascada); `BATCH_REJECTED` queda para carreras y errores inesperados | Un cliente con esquema anterior no corrompe datos derivados; un padre faltante no tira el lote entero; el D1 local no reporta como restricción una llave foránea diferida violada al confirmar |
| T40 | **Plan Workers Free (antes D3).** Pull de 100 filas por tabla por omisión; se vigilan errores 1102/`exceededCpu` y, si aparecen en uso real, se pasa a Paid (5 USD/mes) | Decisión de Mauricio con los datos del spike D: push y pull pasan de 10 ms en p95 (21–26 y 13–23 ms) pero Cloudflare no cortó ninguna petición; costo cero mientras no haya fallas |

## Decisiones abiertas (cerrar en Etapa 0)

| # | Tema | Propuesta | Depende de |
|---|---|---|---|
| D2 | Extracción de tickets | Modelo de visión vía OpenRouter desde el Worker **desde la etapa 1**; OCR local queda como experimento en la etapa 3 | Spike C (exactitud y costo real) |
| D5 | Modelo de rembg | El más ligero que dé calidad aceptable en el A8-7410 | Spike A |
| D9 | Dominio del correo sintético | `maunedas.local`; si Firebase lo rechaza, un dominio con TLD real que nunca recibe correo | Spike E |

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Anti-bot en Amazon, Sam's y Costco (Walmart ya bloquea y salió del tracker, T34) | Baja frecuencia, IP residencial, HTTP antes que navegador, backoff, estado "bloqueado" visible; no se evaden captchas |
| `pnpm --filter api deploy` ejecuta el comando `deploy` de pnpm, no el script | El script se llama `deploy:prod` (y `deploy:dev`) |
| Sam's muestra el precio de un club de CDMX a visitantes sin sesión | T-207 revisa si el precio cambia por club y si se puede fijar uno de Puebla sin login |
| Capacidad del A8-7410 (RAM, CPU, instrucciones para onnxruntime) | Spikes A y B antes de comprometer diseño; concurrencia 1 para Chromium |
| Productos duplicados creados offline por varios usuarios | Códigos únicos, `BARCODE_TAKEN`, herramienta de fusión para admin |
| Relojes de teléfono desfasados (LWW) | Clamp de `updated_at` a `now + 5 min` en el servidor |
| ML Kit Subject Segmentation está en beta | Es solo el nivel T1; T2 en casa cubre el mismo caso |
| Licencia de imágenes de Open Food Facts | Guardar licencia, atribución y URL de origen por imagen |
| Límite de 10 ms de CPU del plan Free: push y pull pasan de 10 ms en p95 (spike D) aunque hoy no se cortan | Pull de 100 filas; vigilar 1102/`exceededCpu` en Workers Logs; T-040 preselecciona candidatos por SQL; plan Paid como salida (T40) |
| Olvido de contraseña sin correo real | Restablecimiento por el admin desde la web |
| CPU del servidor (A8-7410, Puma+) **sin AVX2/FMA**: binarios compilados para x86-64-v3 fallarían | workerd verificado el 2026-10-08 (funciona); onnxruntime se prueba en el spike A; si algo falla localmente, CI corre en runners con AVX2 |
| RAM del servidor (6.7 GB) compartida con Home Assistant y otros contenedores; también es la máquina de desarrollo | Gradle con `-Xmx2g`; no correr Gradle y spikes a la vez; contenedores de spike con `--memory` y `--cpus`; no se toca el compose existente |
| D1 Free: 50 consultas por invocación y 100 parámetros por consulta | Spike D: un batch de 150 sentencias y 60 consultas separadas pasaron sin error (el límite no se aplicó); las lecturas usan `json_each` para no depender de los 100 parámetros |

## Resultados de spikes

### Spike B · scraping (T-011) — 2026-10-19
Una sola pasada sobre 12 URLs (3 por tienda) desde este servidor, en un contenedor efímero con 1.5 GB; 45 s entre peticiones a Amazon y 30 s al resto. Detalle: `docs/spikes/spike-b-scraping.md`.

| Tienda | Resultado | Método |
|---|---|---|
| Amazon | Precio y stock correctos; productos sin oferta → "No disponible por el momento" | HTTP + selectores del bloque `apex`; ubica por IP (Cholula 72760) |
| Walmart | **Bloqueado** desde la primera petición (PerimeterX, `px-captcha`) en `www` y `super` | — (sale del tracker, T34) |
| Sam's | Precio y stock correctos; club por defecto en CDMX | HTTP + JSON-LD y `__NEXT_DATA__` |
| Costco | Precio y stock correctos | HTTP + JSON-LD |

Navegador: no hizo falta en ninguna tienda; costó 8.6–23.5 s y 626–759 MB por página. `mem_limit` recomendado: 1200m. Faltan fixtures "con precio de lista" (no apareció ninguno); se capturan en T-205, T-207 y T-208.

### Spike D · CPU del Worker en Free (T-013) — 2026-10-19
Código real en `maunedas-dev` (plan Free) con rutas temporales y `wrangler tail`; detalle en `docs/spikes/spike-d-cpu.md`.

| Escenario | CPU p50 | CPU p95 |
|---|---:|---:|
| Verificar token de Firebase | 1 ms | 2 ms |
| Firmar token de Google en frío | 2 ms | 4 ms |
| Push de 100 filas (compra de 99 líneas) | 12 ms | 21 ms |
| Push de 50 filas | 11 ms | 26 ms |
| Pull desde cero, 500 filas por tabla | 17 ms | 23 ms |
| Pull, 100 filas por tabla | 6 ms | 13 ms |
| Vinculación ingenua 40 × 500 | 27 ms | 65 ms |
| Batch de 150 sentencias | 2 ms | 3 ms |

Ninguna petición cortada (0 `exceededCpu`); el límite de 50 consultas no se aplicó. D3 → Free (T40).

## Bitácora
- **2026-09-30** — Requisitos cerrados. Implementación cambia a Cloudflare como núcleo. Documentos base v0, esquema validado y fixtures de normalización creados.
- **2026-09-30** — Auth dual (usuario/contraseña + Google), dominio `workers.dev`, CP 72750. SDD v1 escrito.
- **2026-10-08** — Revisión crítica del SDD (41 hallazgos), diagnóstico del entorno y hoja de ruta. Hito 1 completo: repo público, CI, `packages/shared` (113 pruebas sobre los fixtures) y tokens de diseño. Decisiones T25–T33.
- **2026-10-08** — SDD v1.1: entornos de wrangler completos y R2 de dev, dos proyectos de Firebase sin bloquear el registro, prorrateo del descuento de ticket en `v_price_points` (validado en SQLite), reintento idéntico sin conflicto, revocación de Google al cambiar `google_email`, `X-Client-Schema` opcional salvo en sync, límites de D1 en el spike D, URLs firmadas cortas sin ventana de 6 h, `pending_uploads.kind`, `SPIKE_TOKEN` temporal, migración inicial a mano y dependencias y endpoints faltantes en las tareas.
- **2026-10-19** — Cuenta de Cloudflare propia de Maunedas (`maunedas.workers.dev`, T35); se borraron los recursos creados por error en la cuenta de booth360. T-020 en código (falta deploy). Spike B: Amazon, Sam's y Costco funcionan por HTTP; Walmart bloquea y sale del tracker (T34). Decisiones T34–T36.
- **2026-10-19** — T-003 cerrada en la cuenta propia (wrangler con el perfil `maunedas`; el login OAuth necesita un navegador que alcance `localhost:8976` del servidor, que no tiene navegador). T-020 desplegada en dev y prod. El script de producción pasa a `deploy:prod`.
- **2026-10-19** — T-026: esquema D1, Drizzle, semillas y pruebas de fidelidad; migrado y sembrado `maunedas-dev`. Decisión T37.
- **2026-10-19** — T-021: autenticación con tokens de Firebase y `/v1/me`, probada con llaves locales.
- **2026-10-19** — T-022: token de servicio de Google con caché en dos niveles.
- **2026-10-19** — T-027: registro de dispositivos para push.
- **2026-10-19** — T-030: registro de sync y esquemas de fila. Decisión T38.
- **2026-10-19** — T-031: push del sync con LWW y conflictos. Decisión T39.
- **2026-10-19** — T-032: pull del sync con cursor compuesto. El bloque de sync de la Etapa 1 queda completo en el Worker.
- **2026-10-19** — Spike D en `maunedas-dev`: push y pull pasan de 10 ms en p95 pero el plan Free no corta; D3 cerrada → Free con pull de 100 filas (T40). Secreto, rutas y datos del spike retirados.
- **2026-10-19** — T-033: consultas de catálogo y URLs firmadas.
