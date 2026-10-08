# ESTADO — Ahorrando Maunedas

**Última actualización:** 2026-10-08
**Etapa actual:** 0 — Fundaciones. Hito 1 (monorepo, CI, reglas compartidas, tokens) completo; faltan recursos en la nube y spikes.

## Hecho
- Requisitos cerrados (sesiones de preguntas del 2026-09-30).
- Cambio de implementación: **Cloudflare como núcleo**, servidor casero como trabajador.
- `docs/ARQUITECTURA.md` y `docs/esquema-d1.sql` v0 (validado en SQLite: vista de precios, LWW, cursores, índices únicos parciales).
- `fixtures/` con vectores de normalización, promociones, textos (búsqueda y tickets), cantidades de catálogo y usuarios; todos verificados contra implementaciones de referencia.
- **SDD v1** en `docs/sdd/` con requisitos, contratos, diseño por módulo, pruebas y tareas `T-xxx`.
- **Hito 1 (2026-10-08):** repositorio público https://github.com/MauBautista/ahorrando-maunedas (T-001); CI con jobs `ts`, `android` y `agent` en cada push y PR (T-002); `packages/shared` con las reglas compartidas pasando los 6 fixtures, 113 pruebas (T-006); tokens de diseño que generan `tokens.css` y `Tokens.kt`, con prueba de contraste AA (T-007).
- Entorno verificado: la máquina de desarrollo es el servidor casero; workerd (`wrangler dev` y tests del Worker) corre bien en su CPU.

## En curso
- Mauricio: consolas de Cloudflare, Firebase (dos proyectos) y OpenRouter (T-003 a T-005), con la guía de la sesión del 2026-10-08.
- PR de revisión `docs(sdd): v1.1` con los hallazgos de la revisión crítica del SDD que no tocaban el Hito 1.

## Siguiente
1. Hito 2: T-003 (wrangler.jsonc con IDs y deploy de `maunedas-dev`), T-005, spikes A (rembg) y B (scraping) en este servidor.
2. Hito 3: T-004, spike E (correo sintético; primero de los que dependen de Firebase) y spike C (tickets).
3. Spike D (T-013) justo después de T-031; ahí se cierra D3.

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

## Decisiones abiertas (cerrar en Etapa 0)

| # | Tema | Propuesta | Depende de |
|---|---|---|---|
| D2 | Extracción de tickets | Modelo de visión vía OpenRouter desde el Worker **desde la etapa 1**; OCR local queda como experimento en la etapa 3 | Spike C (exactitud y costo real) |
| D3 | Plan de Workers | Empezar en Free; pasar a Paid (5 USD/mes) si el límite de 10 ms de CPU provoca errores 1102 | Spike D |
| D5 | Modelo de rembg | El más ligero que dé calidad aceptable en el A8-7410 | Spike A |
| D9 | Dominio del correo sintético | `maunedas.local`; si Firebase lo rechaza, un dominio con TLD real que nunca recibe correo | Spike E |

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Anti-bot en Amazon, Walmart y Sam's | Baja frecuencia, IP residencial, HTTP antes que navegador, backoff, estado "bloqueado" visible; no se evaden captchas |
| Capacidad del A8-7410 (RAM, CPU, instrucciones para onnxruntime) | Spikes A y B antes de comprometer diseño; concurrencia 1 para Chromium |
| Productos duplicados creados offline por varios usuarios | Códigos únicos, `BARCODE_TAKEN`, herramienta de fusión para admin |
| Relojes de teléfono desfasados (LWW) | Clamp de `updated_at` a `now + 5 min` en el servidor |
| ML Kit Subject Segmentation está en beta | Es solo el nivel T1; T2 en casa cubre el mismo caso |
| Licencia de imágenes de Open Food Facts | Guardar licencia, atribución y URL de origen por imagen |
| Límite de 10 ms de CPU del plan Free | Lotes pequeños, trabajo diferido con `waitUntil`, imágenes por URL; plan Paid como salida |
| Olvido de contraseña sin correo real | Restablecimiento por el admin desde la web |
| CPU del servidor (A8-7410, Puma+) **sin AVX2/FMA**: binarios compilados para x86-64-v3 fallarían | workerd verificado el 2026-10-08 (funciona); onnxruntime se prueba en el spike A; si algo falla localmente, CI corre en runners con AVX2 |
| RAM del servidor (6.7 GB) compartida con Home Assistant y otros contenedores; también es la máquina de desarrollo | Gradle con `-Xmx2g`; no correr Gradle y spikes a la vez; contenedores de spike con `--memory` y `--cpus`; no se toca el compose existente |
| D1 Free: 50 consultas por invocación y 100 parámetros por consulta; no está claro si cada sentencia de un batch cuenta | El spike D mide batches de 102 y 150 sentencias; salidas: push ≤ 45 filas o plan Paid (D3) |

## Resultados de spikes
_Pendiente._

## Bitácora
- **2026-09-30** — Requisitos cerrados. Implementación cambia a Cloudflare como núcleo. Documentos base v0, esquema validado y fixtures de normalización creados.
- **2026-09-30** — Auth dual (usuario/contraseña + Google), dominio `workers.dev`, CP 72750. SDD v1 escrito.
- **2026-10-08** — Revisión crítica del SDD (41 hallazgos), diagnóstico del entorno y hoja de ruta. Hito 1 completo: repo público, CI, `packages/shared` (113 pruebas sobre los fixtures) y tokens de diseño. Decisiones T25–T33.
