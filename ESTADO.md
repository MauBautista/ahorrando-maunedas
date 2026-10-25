# ESTADO — Ahorrando Maunedas

**Última actualización:** 2026-10-19
**Etapa actual:** 0 — Fundaciones (con el backend de la Etapa 1 avanzando). Hito 1, SDD v1.1, T-003, T-020 a T-027, T-030 a T-038, T-041, T-101 a T-106 y spikes B, D y E hechos (T-100 sin el sabor prod); faltan OpenRouter, Firebase prod y los spikes A y C.

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
- **T-034 (2026-10-19):** historial por variante y comparador variante × tienda con la misma regla de mejor precio que la lista; prorrateo del descuento de ticket en `packages/shared` con su fixture; la vista `v_price_points` corregida para compras con todas las líneas en $0 o cupones mayores que la suma (migración 0002, T41); rutas separadas por recurso como en 03 §2; 14 pruebas.
- **T-035 (2026-10-19):** consulta de compras para la web: lista con filtros y paginación, y detalle con líneas, precio por unidad con el cupón prorrateado (también en borradores), promociones y páginas del ticket; 9 pruebas.
- **T-036 (2026-10-19):** búsqueda por código de barras: catálogo propio y, si no está, Open Food Facts → Open Beauty Facts → Open Products Facts con caché (30 días si se encontró, 7 si no), licencia y atribución de la imagen; 13 pruebas sin red.
- **T-037 (2026-10-19):** imágenes en R2: subida de originales y renditions del cliente (la fila debe existir por sync y apuntar a esa clave; la primera subida gana), descarga con sesión o URL firmada, e importación de fotos de Open Food Facts solo desde sus hosts; 16 pruebas. `IMAGE_URL_SECRET` de dev se regeneró (aún no había URLs en uso).
- **T-038 (2026-10-19):** fusión de duplicados (solo admin): al fusionar variantes, códigos, compras, precios, listings, alertas, alias y fotos pasan al destino; al fusionar productos, sus variantes, fotos y etiquetas; el origen queda borrado y los clientes reciben todo por sync; 9 pruebas.
- **T-041 (2026-10-19):** mantenimiento diario a las 04:07 de Ciudad de México dentro del cron horario: borra tokens vencidos, caché de Open Food Facts vencida y trabajos de imagen terminados hace más de 30 días; 3 pruebas con reloj simulado.
- **T-023 (2026-10-19):** administración de usuarios (solo admin): lista, alta con contraseña y/o correo de Google, edición (nombre, rol, activo, correo de Google) y cambio de contraseña, con Identity Toolkit simulado; nunca deja la casa sin admin activo; 18 pruebas. Falta probar contra Firebase real (T-004).
- **T-024 (2026-10-19/21):** `POST /v1/bootstrap` para crear el primer admin una sola vez, protegido con `BOOTSTRAP_TOKEN`; si dos llegan a la vez solo uno gana; 6 pruebas. Admin real `mau` creado en dev con `apps/api/scripts/bootstrap.sh`; el token ya no existe.
- **T-100 (2026-10-20, sin Firebase):** proyecto Android con los 20 módulos del SDD, reglas de dependencias verificadas en el build, catálogo de versiones, Hilt y Compose, sabores `dev`/`prod`; CI corre reglas, pruebas y lint. Faltan los archivos y valores de Firebase (T-004).
- **T-004 dev (2026-10-20/21):** proyecto Firebase `maunedas-dev` completo: verificado por API (proveedores, dominio, redirección, SHA, APIs, restricción de la key, `google-services.json`, secreto de CI) y lo demás confirmado por Mauricio (orígenes, *branding*, APIs de la key, llave vieja borrada). Falta el proyecto de prod.
- **T-025 (2026-10-21):** proxy de `/__/auth/*` y `/__/firebase/*` hacia `maunedas-dev.firebaseapp.com`, para que el login con Google de la web funcione en Safari; en dev `/__/auth/handler` responde igual que Firebase; 6 pruebas.
- **T-101 (2026-10-21):** reglas compartidas en Kotlin (`core:model` y `core:pricing`): precio por unidad, prorrateo, promociones, búsqueda, texto de ticket, cantidades, usuarios e ids; pasan los mismos fixtures que TypeScript, copiados en cada build.
- **T-102 (2026-10-21):** base local de Android en Room: espejo exacto de las 21 tablas que sincronizan, cola de cambios (outbox), subidas pendientes, cursores y conflictos, y la vista de precios; un contrato generado desde el registro y el esquema de D1 impide que Room se desvíe.
- **T-103 (2026-10-21):** red de Android: cliente de la API con el token de Firebase (se renueva y reintenta una vez ante 401), cabeceras de versión, errores de la API con su código y la forma de los datos de sync; 12 pruebas sin red.
- **T-104 (2026-10-22):** sincronización de Android: escribir local y encolar en una transacción (con los borrados en cascada), subir en lotes de 100 aislando la fila que el servidor rechace, bajar por páginas sin pisar cambios locales más nuevos, resolver conflictos y programar con WorkManager; 22 pruebas, incluidos los casos de 04 §8.
- **T-105 (2026-10-22):** subida de fotos en Android: cada foto espera a que su registro llegue al servidor, se reintenta si el servidor aún no la conoce, se descarta con aviso si es demasiado grande o de un tipo no permitido, y el archivo local se conserva; también importa fotos del catálogo abierto pendientes.
- **T-106 (2026-10-22):** sistema de diseño de Android: tema claro y oscuro desde los tokens, ícono de la app, campos de precio y cantidad (aceptan "28.5" y "28,5"), selector de tienda, búsqueda de producto y precio con su precio por unidad y su fuente; probado con la fuente al 200 % sin textos cortados.
- **T-110 (2026-10-22):** login en Android con usuario/contraseña o Google, mensajes del SDD, sesión que abre sin red, cierre de sesión que avisa si hay cambios sin subir; la app sincroniza con WorkManager. Probado en un Pixel 8 Pro contra dev: los cinco casos funcionan y el sync responde 200.
- **T-111 (2026-10-22):** Inicio de Android: botones grandes para nueva compra, foto de ticket, precio de anaquel y escanear; cuánto se gastó en el mes; las últimas cinco compras; avisos de borradores y de cambios rechazados, y cuántos cambios faltan por subir. Barra inferior con las cinco secciones (las que aún no existen dicen que llegan pronto).
- **T-112 (2026-10-22):** catálogo de Android: búsqueda sin acentos (también por código de barras), filtros por categoría con sus subcategorías y por etiqueta, y en cada producto su mejor precio por unidad con tienda, fuente y antigüedad; da los mismos resultados que la API con los mismos datos.
- **T-113 (2026-10-22):** crear y editar productos y presentaciones en Android: nombre, marca, categoría, etiquetas (se pueden crear al vuelo), unidad para comparar precios; el contenido se escribe como "6 × 1 L" y se guarda bien en gramos, mililitros o piezas; varios códigos de barras por presentación (avisa si un código ya es de otro producto); solo el admin puede eliminar.
- **T-114 (2026-10-22):** ficha del producto en Android: sus presentaciones con el último precio por tienda, y un comparador por presentación y tienda (último, mínimo y promedio de 90 días) que marca la opción más barata; da lo mismo que la web. El admin puede fusionar productos o presentaciones duplicados (necesita internet).
- **T-115 (2026-10-22):** historial de precios en la ficha: una gráfica con puntos de colores por fuente (pagado, anaquel, web) y la lista de precios debajo; se filtra por presentación, fuente, periodo y tienda. Da lo mismo que la web.
- **T-120 (2026-10-22):** lista de compras en Android, agrupada por día, con tienda, hora, productos, total y si es borrador; se filtra por tienda, fechas y estado.
- **T-121 (2026-10-23):** registrar compras en Android:
  - tienda (o una nueva) con sucursal, fecha y hora;
  - productos con cantidad (o kilos a granel), precio y promoción (2x1, rebaja, porcentaje, cupón, meses sin intereses…);
  - descuentos del ticket y total del ticket, con aviso si no cuadra;
  - se guarda como borrador al salir y se confirma o elimina; las compras confirmadas ya alimentan la ficha, el comparador y el historial.
- **T-126 (2026-10-23):** Ajustes de Android: cuenta con cambio de contraseña, estado de sincronización (última vez, qué falta por subir, cambios que el servidor rechazó y por qué), liberar espacio de fotos, versión y cerrar sesión. Si un código de barras ya era de otra presentación, la app pregunta si usar esa o mantener la tuya separada.
- **T-166 (2026-10-25):** la cuenta en la web: tus datos, cambiar tu contraseña (pide la actual) y cerrar sesión. El nombre y el correo de Google los cambia el admin, como en Android.
- **T-165 (2026-10-25):** administración en la web (solo admin):
  - usuarios: dar de alta con contraseña generada o correo de Google, editar, restablecer contraseña y activar o desactivar;
  - fusionar productos o presentaciones duplicados, con una vista previa de lo que se moverá antes de confirmar;
  - el gasto de IA del mes contra el tope, con el aviso al pasar el límite suave.
- **T-164 (2026-10-25):** precio de anaquel y escaneo en la web:
  - registrar el precio del anaquel con promoción (dice cuánto sale cada pieza con ella) y foto opcional, en la tienda del último precio guardado en ese navegador;
  - escanear con la cámara del navegador en el precio de anaquel, en los productos de una compra, en los códigos del editor de productos y en la búsqueda del catálogo;
  - un código que no está en el catálogo ofrece darlo de alta con el código ya puesto.
- **T-162 (2026-10-25):** compras en la web:
  - la lista por día con filtros de tienda, fechas y estado, y el detalle de cada compra con sus páginas de ticket;
  - el editor con las reglas de Android: buscar el producto con su último precio en la tienda, promociones, descuentos del ticket, total del ticket que avisa si no cuadra, confirmar, eliminar y guardado automático al salir;
  - en la computadora, una tabla donde cantidad y precio se escriben directo;
  - Inicio con el gasto del mes, aviso de borradores y las compras recientes;
  - se corrigió el servidor: las ediciones de la web (compras y también productos de T-161) se rechazaban si no traían la fila completa.
- **T-161 (2026-10-25):** catálogo, ficha y editor de productos en la web:
  - buscar, filtrar por categoría y etiqueta y ver el mejor precio de cada producto;
  - la ficha con presentaciones, comparador por tienda e historial con gráfica;
  - crear productos con su primera presentación, editarlos, agregar presentaciones y códigos, y (admin) borrarlos;
  - las mismas reglas que Android: etiqueta sugerida, a granel, unidad para comparar y avisos de código ya usado.
- **T-160 (2026-10-25):** esqueleto de la web en `maunedas-dev.maunedas.workers.dev`:
  - login con usuario y contraseña o con Google;
  - Inicio, navegación que se adapta al teléfono y a la computadora, y Cuenta con "Cerrar sesión";
  - las demás pantallas dicen "llega pronto" (T-161 a T-166);
  - probado en el navegador del Samsung; falta probar en Safari de iPhone.
- **T-039 (2026-10-25):** gateway de IA y presupuesto en el Worker:
  - toda llamada a la IA pasa por un solo lugar que elige el modelo, revisa el tope de 6 USD al mes y registra el costo real;
  - reintenta una vez y no cobra lo que no respondió;
  - el admin ve el gasto del mes y si pasó el 80 % (`GET /v1/admin/ai-budget`);
  - falta elegir el modelo (spike C) y poner la key (T-005).
- **T-124, primera parte (2026-10-24):** en el editor de compra:
  - "Ordenar" cambia el orden de los productos (y TalkBack ofrece "Subir" y "Bajar");
  - "Vincular" liga una línea del ticket a su producto;
  - al confirmar, cada texto de ticket vinculado se aprende para esa tienda, así la siguiente compra se vinculará sola cuando llegue la lectura del ticket.
- **T-123 (2026-10-24):** foto de ticket en Android:
  - en el editor de compra y en Inicio, con el escáner de documentos de Google (1 a 4 páginas recortadas), o con la cámara si no está disponible;
  - se elige la tienda primero;
  - las páginas se guardan en el teléfono al tomarlas y se suben solas;
  - la lectura con IA del ticket llega con T-124 (necesita el spike C y la key de OpenRouter).
- **T-117 (2026-10-24):** fotos de producto en Android:
  - en el editor de producto: "Tomar foto", "Elegir de la galería" y "Quitar foto";
  - un producto nuevo creado desde el escáner trae la foto de Open Food Facts, que se importa al guardar;
  - el catálogo muestra miniaturas y la ficha la foto grande, aun sin internet si la foto se tomó en ese teléfono.
  - probado en un Galaxy A53: la cámara, la descarga desde el servidor y la importación desde Open Food Facts; ahí se corrigió un error de caché que dejaba una foto importada sin mostrarse.
- **T-122 (2026-10-24):** escaneo continuo en la compra:
  - "Escanear productos" deja la cámara abierta y cada código agrega su producto al último precio de esa tienda, con el campo de precio listo;
  - volver a escanear el mismo producto le suma una pieza;
  - lo que aún no está en el teléfono se baja del servidor o se da de alta, y se agrega solo al llegar;
  - no se puede confirmar con productos sin precio;
  - probado en un Galaxy A53, donde aparecieron lecturas falsas con poca luz: ahora cada código debe leerse dos veces.
- **T-125 (2026-10-24):** precio de anaquel en Android:
  - el producto viene del escáner, de una búsqueda o de escanear ahí mismo;
  - tu última tienda y sucursal ya vienen puestas;
  - se escribe el precio, con promoción opcional (muestra cuánto sale cada pieza con un 2x1, por ejemplo) y foto opcional del anaquel, que se sube sola;
  - "Guardar y otro" deja la tienda para seguir con el recorrido;
  - el precio entra de inmediato a la ficha, el comparador y el historial.
- **T-116 (2026-10-24):** escáner de códigos en Android:
  - con la cámara (también sin internet), linterna, vibración y sonido; o escribiendo el código;
  - si el producto ya existe, muestra sus últimos precios y permite agregarlo a la compra abierta o verlo;
  - si no, lo busca en el servidor o en catálogos abiertos y ofrece crearlo ya prellenado, o como otra presentación de un producto que ya tienes.
- **Spike E (T-014, 2026-10-21):** Firebase acepta el correo sintético `@maunedas.local`; alta, login (REST y Firebase JS), desactivación y cambio de contraseña funcionan con el código real del Worker. D9 cerrada (T47).

## En curso
- Mauricio: Firebase prod (T-004, puede esperar al primer despliegue a producción); OpenRouter (T-005); 10 fotos para el spike A.

## Siguiente
1. Web: T-163 (tickets) espera a T-040; T-160 se cierra al probar Google en Safari del iPhone. Hallazgo para Android (T76): S-15 ofrece "Cambiar contraseña" también con sesión de Google y responde "La contraseña actual no es correcta".
2. Pantallas de Android: T-124 (revisión de ticket; la extracción necesita el spike C y la key de OpenRouter); T-118 (recorte en el teléfono) es opcional.
3. Spike A en cuanto estén las 10 fotos; T-005 (OpenRouter) y spike C (tickets) para T-039/T-040.
4. Antes del primer despliegue a producción: T-004 (Firebase prod) y la decisión pendiente de T41.

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
| T41 | **`v_price_points` sin división entre cero.** El factor del descuento de ticket es `1 − min(descuento, Σ final) / Σ final`, y 1 si Σ final = 0 (migración `0002_price_points_guard.sql`, `esquema-d1.sql`, `prorateTicketDiscount`, fixture `prorrateo_ticket`) | La fórmula del SDD daba precio NULL cuando todas las líneas valían $0 y precios negativos con un cupón mayor que la suma de las líneas; no cambian columnas sincronizadas, así que `schema_version` sigue en 1. Room aún no existe: su `@DatabaseView` se escribe en T-102 con el SQL de `esquema-d1.sql` y pasa el mismo fixture |
| T42 | **Fallas del catálogo abierto.** Si ningún catálogo encontró el código y alguno falló (HTTP ≠ 200/404, red, JSON inválido o > 5 s), no se guarda `found=0`: se sirve la caché positiva vencida o se responde `502 UPSTREAM_ERROR` (`service: open_catalog`) | El SDD no cubría las fallas; guardar un "no encontrado" por un error escondería el producto 7 días. Una falla no detiene la búsqueda en los catálogos siguientes |
| T43 | **Binarios inmutables, la primera subida gana.** `PUT` de una clave que ya está en R2 responde `201` con su tamaño sin sobrescribir; la importación tampoco vuelve a descargar | Las URLs se sirven con `Cache-Control: immutable`; sobrescribir dejaría cachés con otra imagen. Un reintento del `UploadWorker` sigue siendo idempotente |
| T44 | **Fusión: también fotos y filas borradas.** El destino recibe las imágenes del origen y, si no tenía, su foto principal; se mueven también las filas ya borradas que apuntaban al origen; un id inexistente responde `404` | El SDD no decía qué pasaba con las fotos (quedarían en un registro borrado) ni con los tombstones; moverlos evita referencias a una variante muerta si alguien revive una fila |
| T45 | **Usuarios: Firebase primero y reversión.** Activar o desactivar cambia cada cuenta de Firebase antes de D1 y las regresa si algo falla; `google_email` en minúsculas (cambiar solo mayúsculas no borra identidades); una carrera de `UNIQUE` tras crear la cuenta compensa y responde `409`; contraseña a un usuario inactivo crea la cuenta desactivada | El SDD fijaba la compensación del alta pero no el orden ni las fallas a medias de la activación; así ninguna cuenta queda activa en Firebase con el usuario inactivo en D1, ni al revés |
| T46 | **Android: convenciones y Firebase opcional.** Plugins de convención en `build-logic` (SDK, Java 17, `namespace` por ruta, `unitTests`, `checkModuleDependencies`); `google-services` solo se aplica si existe el JSON del sabor; versiones estables con dos semanas o más (Kotlin 2.4.20 aunque exista 2.4.21) | Veinte módulos sin repetir configuración; el proyecto compila y CI corre antes de T-004; las reglas de 05 §2 se vuelven verificables. Mismo criterio de antigüedad que pnpm |
| T47 | **Correo sintético `@maunedas.local` (antes D9).** Es el `SYNTHETIC_EMAIL_DOMAIN` de Worker, web y Android | Spike E: Firebase lo acepta en alta, login REST y JS, contraseña y `disableUser`; nunca puede recibir correo. Falta confirmarlo en Android (T-110) |
| T48 | **Contrato de esquema para Room.** `packages/shared/sync-schema.json` (registro + `esquema-d1.sql`) es la fuente de las entidades de Room, verificada en ambos lados; booleanos `Int`; sin índices únicos parciales en Room; el outbox sale en el `order` del registro | Un solo origen de verdad sin copiar tablas a mano: D1 ↔ registro (api), registro + esquema ↔ contrato (shared), contrato ↔ Room (Android). Room no expresa índices parciales y el servidor ya resuelve la unicidad (04 §3.2); el orden evita `MISSING_PARENT` entre lotes |
| T49 | **Red de Android.** El token llega por `IdTokenProvider` (Firebase en `core:auth`, T-110); los errores se convierten en `ApiException` en un `CallAdapter` de Retrofit, no en un interceptor; `encodeDefaults = true`; un cuerpo que no es del Worker es `HTTP_ERROR` y una falla de red sigue siendo `IOException` | Probar sin Firebase; un interceptor de OkHttp solo puede lanzar `IOException` y el `SyncWorker` reintenta ante `IOException`, así que los errores de la API no deben parecer fallas de red; sin `encodeDefaults` el push no podría borrar un valor |
| T50 | **Sync de Android probado sin WorkManager.** La lógica vive en `SyncEngine` y `SyncWorker` solo traduce resultados (sin sesión → nada; red/5xx/429 → reintento; otro 4xx → falla; 426 → espera actualización); el lote también se divide ante `413`; el pull pide 100 filas; conectar WorkManager y Firebase en la app queda para T-110 | Los casos de 04 §8 se prueban con Room en memoria y MockWebServer; un lote de 100 filas grandes puede pasar de 512 KB; T40 fijó 100 filas; sin `IdTokenProvider` real no tiene caso arrancar los workers |
| T51 | **Subidas: qué se reintenta y qué se descarta.** `IMAGE_NOT_FOUND`, 5xx, 401, 403 y 429 se reintentan; los demás 4xx y un archivo local faltante pasan a `sync_issues`; una rendition espera también a su propia fila | El SDD solo nombraba 409 y 413/415; perder una foto por un token vencido no tiene sentido, y la rendition se valida contra su propia fila en el Worker (10 §4.1) |
| T52 | **Diseño de Android.** `Money`/`Quantities` en `core:model` (regla de separadores: uno solo es decimal, repetido agrupa, con ambos manda el de la derecha); colores XML generados desde los tokens; la prueba del 200 % usa Robolectric con gráficos nativos, una ventana de 360 × 800 dp desplazable y cuenta la elipsis como corte | `core:designsystem` no puede depender de `core:ui` (ciclo); los colores no se copian a mano; con gráficos heredados Robolectric no mide texto y la prueba daba falsos positivos |
| T53 | **Login de Android y cuerpos de petición.** La pantalla habla con `AuthService` (falso en pruebas); `GET /v1/me` decide quién entra y, ante 403 o sin red, se cierra Firebase; la sesión vive en DataStore y permite abrir sin red; cerrar sesión borra Room, fotos locales, sesión y `device_id`. Un campo opcional en `null` se omite del JSON (`@EncodeDefault(NEVER)`) | Zod `.optional()` rechaza `null` y `MaunedasJson` usa `explicitNulls`: el pull mandaba `"tables": null` y recibía 400, y la prueba esperaba ese null. Lo detectó la prueba en teléfono, no las pruebas unitarias |
| T54 | **Inicio y armazón de Android.** Sin total de ticket, una compra vale Σ líneas vivas − descuento de ticket, nunca menos de cero; el mes es el de la Ciudad de México. Las horas siguen el formato de 12 o 24 horas del teléfono. Íconos de Material Symbols como vectores. La barra inferior existe desde ya: lo que falta muestra "llega pronto" y las acciones de Inicio abren la pestaña que las tendrá. `hiltViewModel` desde `hilt-lifecycle-viewmodel-compose`. La prueba de textos cortados no usa `hasVisualOverflow` | Es la regla de RF-COM-06 y la que verá la web. El teléfono de Mauricio usa 12 horas y la app decía "22:46". La biblioteca de íconos de Compose ya no se actualiza. Sin barra, cada pantalla nueva tendría que rehacer la navegación. `hilt-navigation-compose` quedó obsoleta. La semántica acomoda el párrafo a todo el ancho y marca como desbordado cualquier texto de una línea más angosto que su fila: era el falso positivo de T-106 |
| T55 | **Catálogo de Android.** Misma sentencia que `GET /v1/products` y misma regla de mejor precio (`BestPrices` = `pickBest`), probadas con los datos de la prueba de la API. Paging 3.5.2 (la 3.5.3 tenía menos de dos semanas). La miniatura de la tarjeta llega con T-117 y hasta entonces se muestra la inicial | Web y Android deben mostrar lo mismo. Sin fotos en dev, Coil y la carga con token no se podrían probar con imágenes reales; T-117 trae la primera foto |
| T56 | **Editores de producto y presentación.** Un producto nuevo se crea con su primera presentación y la unidad para comparar sigue su medida. Las etiquetas nuevas se crean al guardar y reutilizan la que tenga el mismo nombre. Un código ya usado se rechaza diciendo de quién es; la fusión (admin, con red) va en la ficha (T-114) y "Escanear código" con el escáner (T-116). Hasta que exista la ficha, la tarjeta del catálogo abre el editor | S-09 sugiere la unidad "por la medida de la primera variante", así que esa variante tiene que existir desde el alta. Sin escáner ni ficha todavía, así se puede usar el catálogo de punta a punta desde ya |
| T57 | **Fusión de admin desde Android con llamada directa** (decisión de Mauricio, 2026-10-22). `POST /v1/admin/merge` se llama desde la pantalla, como el login: es una excepción más de la red de 05 §3 y de la regla 12 de CLAUDE.md. Antes revisa que no haya cambios por subir y después pide un sync | Solo el servidor mueve todas las referencias, y el admin necesita ver al momento si se pudo ("no se pueden fusionar masa con volumen"). Hacerlo en segundo plano daría el error lejos de donde se pidió; dejarlo solo en la web quitaba la fusión del aviso de código repetido (RF-CAT-03) |
| T58 | **Historial de Android.** Solo puntos por fuente, sin unirlos; periodo elegible (3 meses, 1 año por omisión, todo); lista de precios bajo la gráfica, del más nuevo al más viejo, y una descripción de la gráfica para lectores de pantalla. La serie web se ve como puntos hasta T-222 | RF-PRE-02 pide puntos de compra y anaquel: unirlos inventaría precios intermedios. La API ya acepta `from`/`to` y un año ocultaba lo anterior. Una gráfica no se lee con TalkBack ni con letra al 200 %; la lista sí |
| T59 | **Lista de compras.** Fechas con atajos (este mes, mes pasado, últimos 3 meses) además de elegir días; la tienda se filtra entre las que tienen compras. "Nueva compra" y tocar una compra ya van a la ruta del editor, que dice "llega pronto" hasta T-121 | S-03 pide "rango de fechas": los atajos cubren lo común con un toque y el selector lo demás. Listar todas las tiendas daría opciones que nunca devuelven nada. Con la ruta lista, T-121 solo cambia la pantalla |
| T60 | **Editor de compra.** Barra fija solo con el total y los botones; el resto del pie se desplaza. Productos en el orden de captura (reordenar va con T-124); quitar con botón además de deslizar. Autoguardado al salir y al pasar a segundo plano, serializado. El cupón de línea es por monto. Tienda y sucursal en hojas separadas | Un pie fijo completo no cabe con letra al 200 %. El orden importa sobre todo al revisar un ticket. Deslizar no es accesible con TalkBack. Salir y pasar a segundo plano coinciden y no deben crear dos compras. El porcentaje ya tiene su tipo |
| T61 | **Ajustes y sincronización.** La última sincronización exitosa se guarda en el teléfono y se olvida al cerrar sesión. El diálogo del código repetido sale sobre cualquier pantalla. "Usar esa presentación" mueve solo lo que un miembro puede cambiar (no precios web ni alertas ajenas) y deja mi presentación. Los rechazos se resuelven con "Entendido". "Liberar espacio" conserva las fotos sin subir | S-16 pide "última sincronización", y en memoria se perdía al reabrir. El servidor rechazaría (FORBIDDEN) mover filas que el miembro no puede tocar, y borrar una presentación es del admin. Una foto sin subir solo existe en el teléfono |
| T62 | **Escáner.** Solo códigos numéricos de 6 a 14 dígitos; el mismo código se ignora mientras siga a la vista (2 s). Hay una opción para escribir el código. "¿Es otra presentación…?" también para códigos desconocidos o sin red. Los códigos leídos van con `source = 'scan'`. Los prellenados viajan como texto en la ruta. La foto del catálogo abierto va con T-117 | `barcodes.code` exige dígitos. Sin la opción de escribirlo, una etiqueta dañada o un permiso negado dejan sin salida. Un código nuevo de un producto conocido es común. Las rutas tipadas no garantizan `Int?`/`Double?`. Importar la foto necesita el flujo de imágenes de T-117 |
| T63 | **Precio de anaquel.** El efectivo es el de una pieza a la cantidad mínima que activa la promoción, con las fórmulas de S-05; MSI no cambia el precio. La fila de `promotions` lleva `observation_id` y el descuento por pieza. `promo_text` se arma del tipo y sus parámetros. "Recuerda la última" usa mis observaciones `shelf`. La foto se toma con la app de cámara del teléfono, se reduce a 2048 px sin EXIF y se sube por `UploadQueue`. El selector de promociones y las hojas de tienda pasan a `core:ui` | Un precio de anaquel compara piezas sueltas: un 2x1 en el anaquel vale lo que una pieza comprada en 2x1. Un texto armado es uniforme para las alertas y la web. Las tiendas de anaquel y de compra no siempre coinciden. La app de cámara enfoca y usa el flash mejor que una captura propia, y la reducción sirve igual a T-117 y T-123. Sin EXIF no sale la ubicación |
| T64 | **Escaneo continuo.**<br>• La cámara va sobre el editor, en la misma pantalla, y no se pausa.<br>• Pide la tienda primero.<br>• Cada código que ya está aquí agrega una línea al último precio de lista en esa tienda y enfoca su precio.<br>• **Hallazgo frente a RF-COM-09** (que pedía una línea por escaneo): la misma presentación sin promoción y que no se pesa suma una pieza a su línea.<br>• Los códigos que no están aquí esperan, aun con la cámara cerrada: del servidor se bajan; los desconocidos se dan de alta en S-12 (`ScanCodeDestination`).<br>• Una línea sin precio queda en $0: se guarda como borrador, pero no se confirma.<br>• Un código cuenta cuando se lee dos veces en menos de 1 s, y los códigos en espera se pueden quitar. | Seis yogures serían seis líneas iguales y seis puntos repetidos en el historial. Con la misma pantalla, cada línea entra al borrador que ya se autoguarda. S-12 ya resuelve los cuatro caminos de un código nuevo. Un $0 confirmado sería el "mejor precio" del comparador. En un Galaxy A53, con poca luz, una etiqueta dio lecturas falsas de un solo cuadro que pasaban el dígito verificador. |
| T65 | **Fotos de producto.** S-18 es una sección de S-09, no una pantalla aparte. La foto se guarda con el producto y la anterior recibe tombstone. La del catálogo abierto se importa siempre por la cola, no se muestra antes de importarla y el editor dice de dónde vendrá. Para mostrar, primero el archivo del teléfono en el orden de 10 §1; si no, el blob del Worker con Coil 3 y la sesión. Caché en disco de 100 MB, que solo guarda respuestas 2xx. No se pide una foto que sigue en la cola de este teléfono. La galería usa el selector de fotos del sistema. Las fotos de presentación quedan fuera de E1 | La foto es un dato más del producto. La importación exige que la fila ya esté en el servidor (10 §2.3), así que llamarla de inmediato daría 409. La app no habla con Open Food Facts (regla 12). El archivo local funciona sin red y recién tomado. Las claves de R2 no cambian. El selector no pide permisos. En un Galaxy A53, Coil guardó el 404 de una foto pedida antes de su importación y la tarjeta se quedó sin foto. |
| T66 | **Foto de ticket.** Escáner de documentos de ML Kit (1 a 4 páginas) y la app de cámara si no está disponible. Pide la tienda primero. Una compra nueva se guarda como borrador antes de sus páginas. Cada página se escribe al tomarla (`images` con `role='receipt'`, en orden por `created_at`) y va a la cola de subida. `purchases.receipt_image_id` no se usa | `purchases.store_id` es obligatorio, y guardar el borrador primero da a las páginas un dueño que se sincroniza. Escribirlas al momento cumple RF-TIC-01 sin red ni con la app cerrada. El escáner necesita Play services y descarga su módulo la primera vez. 03 §7 lee las páginas por dueño y rol. |
| T67 | **Ordenar y vincular líneas (S-04).** Un modo "Ordenar" con ↑↓ y "Subir"/"Bajar" de TalkBack siempre, sin arrastrar. "Vincular" abre la hoja de la línea con el texto del ticket. Los alias se aprenden al confirmar cualquier compra, en `PurchaseEditor.save`; vale para S-04 y para la futura S-06 | Los botones funcionan igual con TalkBack y en pantallas chicas. Arrastrar en una lista con deslizar para borrar choca con el gesto. Un solo lugar escribe las compras, y con el id determinista confirmar dos veces no duplica. |
| T68 | **Gateway de IA.**<br>• **Antes de llamar:** se revisa el presupuesto antes de cada intento, en micro-dólares enteros. Sin modelo elegido, sin key o con proveedor desconocido, `503`.<br>• **Qué se cobra:** cada respuesta (válida o no), con el costo reportado o el estimado. Timeouts, 5xx y 429 no se cobran y se reintentan una vez.<br>• **Errores:** un 4xx del proveedor es `502` sin reintento. Una salida no válida tras el reintento es `422 EXTRACTION_FAILED`.<br>• **Aviso del 80 %:** en E1 es una línea de log más `soft_limit_reached`. | Un intento puede gastar, así que el siguiente debe caber en el tope. En flotantes, llegar justo al tope se decidiría por redondeo. Sin respuesta no hay tokens que pagar. Una salida inválida sí costó. Un 4xx no mejora al repetirlo. El push al admin llega con T-213. |
| T69 | **Esqueleto web.**<br>• React Router 8 (la API *data* de la 7, sin cambios para este uso), TanStack Query 5 y Tailwind 4 con los tokens como tema.<br>• Firebase detrás de `AuthPort`, inyectado por contexto.<br>• Un error 5xx o sin red en `/v1/me` ofrece "Reintentar" y no cierra la sesión.<br>• `USER_NOT_ALLOWED` o `USER_DISABLED` sí la cierran.<br>• Íconos generados por script.<br>• `CLIENT_SCHEMA = 1` en la web, como Android. | React Router 8 es la versión estable vigente con más de dos semanas, y su modo *data* conserva la API. Con un puerto inyectado las pruebas no hablan con Google. Perder la red no debe sacar a nadie. Un admin que quita la cuenta sí. Sin herramientas de imágenes en la máquina, un PNG a mano es reproducible. |
| T70 | **Catálogo y ficha web.** Filtros y pestaña en la URL. "Ver más" en vez de desplazamiento infinito. Comparar como tabla con desplazamiento horizontal. Recharts solo al abrir Historial. Antigüedad contada desde que llegaron los datos | Una búsqueda o una pestaña deben sobrevivir a "Atrás" y poder compartirse. Un botón funciona con teclado y lector de pantalla, y no depende de `IntersectionObserver`. En la web la tabla cabe; en Android se usaron tarjetas por la letra al 200 %. La ficha pesaba 446 KB por la gráfica. La regla de pureza de React no deja leer el reloj durante el render. |
| T71 | **Editor web por push.**<br>• Un producto nuevo y su primera presentación van en un push; cada presentación se guarda en su diálogo.<br>• Los cambios mandan solo lo editado, con `updated_at` posterior a lo leído.<br>• `GET /v1/products/:id` agrega `barcode_rows` para poder quitar códigos.<br>• El dueño de un código se busca con `GET /v1/search/variants`, no con `/v1/barcodes/:code`.<br>• Tras un `STALE` se recarga el formulario.<br>• La lectura de cantidades y precios y la conversión de contenido pasan a `packages/shared` con los casos de Android. | La web no guarda datos locales (04 §7): escribe y vuelve a consultar. El servidor actualiza solo las columnas enviadas (04 §3.3). Quitar un código es el tombstone de su fila, que antes no tenía id en la web. La búsqueda no consulta Open Food Facts. La misma regla de captura en los dos clientes evita diferencias de redondeo. |
| T72 | **Compras web con las reglas de Android.**<br>• La aritmética de la compra (`pricing/purchase.ts`) pasa a `shared` con los casos de `PurchaseMathTest`.<br>• La búsqueda de variantes trae su contenido y, con `store_id`, el último precio de lista en esa tienda.<br>• Escritorio: tabla con cantidad y precio en su celda; teléfono: tarjetas con diálogo.<br>• Al salir se guarda lo que cambió (si hay tienda), como Android.<br>• Los alias de ticket se escriben en cada confirmación con su UUIDv5. | El editor web debe guardar las mismas filas que Android. Sin datos locales (04 §7), la línea necesita del servidor lo que Android lee de Room. 06 §3 pide la tabla editable en escritorio. La web no lee `receipt_aliases`, y reescribir el mismo id es idempotente. |
| T73 | **El upsert inserta la fila fusionada.** El `INSERT` lleva la fila de D1 con la mutación encima; el `UPDATE` del conflicto sigue cambiando solo las columnas enviadas (04 §3.3). | SQLite revisa `NOT NULL` antes del `ON CONFLICT`. Una fila parcial de la web o un tombstone sin `created_at` rechazaba el lote entero (`BATCH_REJECTED`). Afectaba la edición web de productos de T-161, que solo se había probado con fake Worker. Android manda filas completas y no se veía. |
| T74 | **Anaquel y escaneo web.**<br>• `@zxing/browser` 0.2.1 y `@zxing/library` 0.23.0, cargados solo al escanear.<br>• Mismos formatos, normalización y `ScanGate` que Android.<br>• Un código por línea en W-05, sin modo continuo.<br>• Un código desconocido abre `/productos/nuevo?codigo=…`.<br>• La foto del anaquel se reduce en el navegador y sube después del push.<br>• La tienda recordada es por navegador (`localStorage`).<br>• `shelfEffectiveCents` pasa a `shared` con los casos de `ShelfPricesTest`. | 06 §3 pide zxing (Safari de iPhone no tiene `BarcodeDetector`). Las lecturas falsas de un cuadro se vieron en el Samsung (T64). La subida necesita que la fila `images` exista (409 si no). La web no tiene filas propias para saber mi último anaquel. |
| T75 | **Administración web.**<br>• La vista previa de la fusión es `dry_run` en la misma ruta: cada movimiento se describe una vez y de ahí salen su `UPDATE` y su conteo.<br>• Las contraseñas se generan en el navegador (12 caracteres sin ambiguos, `crypto.getRandomValues`, sin sesgo) y se muestran en claro para entregarlas en persona.<br>• La edición manda solo lo que cambió.<br>• Los mensajes del servidor se muestran tal cual. | 06 §3 pide la vista previa y no había cómo contar sin escribir. Una sola descripción evita que la vista previa y la fusión real cuenten distinto (una prueba lo compara). Un `PATCH` vacío es 400 y cambiar el correo de Google cierra esa sesión, así que no se manda lo que no cambió. Los mensajes de 03 §1.2 ya están en español. |
| T76 | **Cuenta web.**<br>• El nombre y el correo de Google solo se muestran; los cambia el admin.<br>• La contraseña se cambia en el navegador con `reauthenticateWithCredential` + `updatePassword`.<br>• Con una sesión de Google no se ofrece el cambio: se explica que hay que entrar con usuario y contraseña. | No hay ruta para editarse a sí mismo, y Android (S-15) solo los muestra. El Worker no debe ver contraseñas (regla 11). Cada método es su propia cuenta de Firebase (02 §2): con Google, la reautenticación usa ese correo y fallaría con "contraseña incorrecta", como pasa hoy en Android (hallazgo). |

## Decisiones abiertas (cerrar en Etapa 0)

| # | Tema | Propuesta | Depende de |
|---|---|---|---|
| D2 | Extracción de tickets | Modelo de visión vía OpenRouter desde el Worker **desde la etapa 1**; OCR local queda como experimento en la etapa 3 | Spike C (exactitud y costo real) |
| D5 | Modelo de rembg | El más ligero que dé calidad aceptable en el A8-7410 | Spike A |

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
| El handler de Firebase pidiera `/__/firebase/init.json`, que da 404 porque no hay sitio de Hosting | El SDK pasa la configuración por la URL; se confirma con el login con Google de la web (T-160); salida: desplegar un sitio vacío de Firebase Hosting |

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

### Spike E · Correo sintético (T-014) — 2026-10-21
Worker local con el código real (bootstrap, admin de usuarios) contra el proyecto `maunedas-dev`; detalle en `docs/spikes/spike-e-correo.md`. `maunedas.local`, `maunedas.test`, `maunedas.invalid` y `users.maunedas.workers.dev`: alta, login REST, `/v1/me`, `USER_DISABLED` al desactivar y contraseña nueva, todo OK; login con Firebase JS OK en `maunedas.local` con el `Referer` del host permitido (la API key está restringida). Cuentas de prueba borradas (0 en el proyecto). D9 → `maunedas.local`.

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
- **2026-10-19** — T-034: historial, comparador y prorrateo del descuento de ticket; vista de precios corregida (T41).
- **2026-10-19** — T-035: consulta de compras (lista y detalle).
- **2026-10-19** — T-036: búsqueda por código de barras con Open Food Facts y caché (T42).
- **2026-10-19** — T-037: subida, descarga firmada e importación de imágenes (T43).
- **2026-10-19** — T-038: fusión de productos y variantes duplicados (T44). Bloque T-033 a T-038 completo.
- **2026-10-19** — T-041: cron de mantenimiento diario. El backend sin Firebase de la Etapa 1 queda completo.
- **2026-10-19** — T-023: administración de usuarios con Identity Toolkit simulado (T45).
- **2026-10-19** — T-024: bootstrap del primer admin (falta el admin real en dev, con Firebase).
- **2026-10-20** — T-100: proyecto Android multi-módulo con reglas de dependencias, Hilt, Compose y sabores (T46); faltan los datos de Firebase.
- **2026-10-20** — T-004 (dev, parcial): configuración pública de `maunedas-dev` en Worker, web y Android.
- **2026-10-21** — Spike E: `@maunedas.local` funciona en Firebase (D9 cerrada, T47); cuenta de servicio de dev cargada.
- **2026-10-21** — T-024 cerrada: admin real en dev; Firebase dev verificado por API; script de bootstrap.
- **2026-10-21** — T-025: proxy de auth de Firebase; Firebase dev completo. Worker de la Etapa 1 (T-020 a T-027) terminado.
- **2026-10-21** — T-101: reglas compartidas en Kotlin con los fixtures.
- **2026-10-21** — T-102: Room con contrato de esquema (T48).
- **2026-10-21** — T-103: red de Android con MockWebServer (T49).
- **2026-10-22** — T-104: sincronización de Android (T50).
- **2026-10-22** — T-105: subida de fotos en Android (T51).
- **2026-10-22** — T-106: sistema de diseño de Android (T52).
- **2026-10-22** — T-110: login y sesión en Android (código y pruebas); falta la prueba en teléfono.
- **2026-10-22** — Prueba de T-110 en un Pixel 8 Pro (Android 17): login con `mau@maunedas.local` correcto; el pull fallaba con 400 porque el cliente mandaba `"tables": null` y el Worker solo acepta la clave ausente o una lista (la prueba con MockWebServer esperaba el null). Corregido; el sync termina en 200.
- **2026-10-22** — T-110 cerrada: Mauricio probó en el teléfono contraseña incorrecta, login, arranque sin red, cierre de sesión y Google; los logs del Worker coinciden (`/v1/me` 200, dispositivo registrado y borrado con 204, pulls en 200).
- **2026-10-22** — T-111: Inicio de Android (S-02), barra inferior y Ajustes provisional; la prueba de fuente al 200 % ya no da falsos positivos. Revisado en el teléfono; las horas ahora siguen su formato de 12 horas.
- **2026-10-22** — T-112: catálogo de Android con búsqueda, filtros y mejor precio por unidad, iguales a los de la API; miniatura pospuesta a T-117 (T55).
- **2026-10-22** — T-113: editores de producto y presentación en Android (S-09, S-10) con asistente de contenido, códigos y etiquetas; eliminar solo para admin (T56).
- **2026-10-22** — T-114: ficha del producto en Android con presentaciones y comparador iguales a la API, y fusión de admin con llamada directa (T57, decisión de Mauricio). Los `strings.xml` declaran `tools:locale="es"`: lint revisaba la ortografía en inglés y ahora exige el plural `many` del español.
- **2026-10-22** — T-115: historial de precios con Vico 3.3.1 (ya estaba en el catálogo desde T-100), filtros y lista accesible; mismos puntos que la API (T58).
- **2026-10-22** — T-120: lista de compras de Android con agrupación por día y filtros de tienda, fechas y estado (T59).
- **2026-10-23** — T-121: editor de compra y de línea en Android con promociones según fixtures, granel, descuentos de ticket, validación del total, cascadas y autoguardado (T60).
- **2026-10-23** — T-126: Ajustes, estado de sincronización, cambios rechazados y diálogo de código repetido en Android; cambio de contraseña y liberar espacio (T61).
- **2026-10-24** — T-116: escáner (CameraX + ML Kit) y los cuatro caminos de S-12; prellenado de editores y "Agregar a la compra abierta" (T62).
- **2026-10-24** — T-125: precio de anaquel (S-13) con promoción, foto y "Guardar y otro"; fotos locales reutilizables y selector de promociones compartido (T63).
- **2026-10-24** — T-122: escaneo continuo en la compra, con los códigos en espera que se agregan al llegar; corregidos textos de compras que pisaban a los de catálogo (T64).
- **2026-10-24** — T-117: foto de producto con cámara y galería, importación de la foto del catálogo abierto, miniaturas con Coil (T65).
- **2026-10-24** — T-123: foto de ticket con el escáner de documentos (1 a 4 páginas, cámara como respaldo), guardada al tomarla y subida sola; probada en un Galaxy A53 (T66).
- **2026-10-24** — T-124 (primera parte): ordenar líneas, "Vincular" y alias al confirmar (T67); la extracción y S-06 siguen esperando el spike C.
- **2026-10-25** — T-039: gateway de IA con presupuesto, reintento y costo real; `GET /v1/admin/ai-budget` (T68).
- **2026-10-25** — T-160: esqueleto web (login, armazón, sesión, cliente HTTP) desplegado en dev y probado en el Samsung; falta Safari de iPhone (T69).
- **2026-10-25** — T-161 (primera parte): catálogo y ficha web con comparador e historial, desplegados en dev (T70).
- **2026-10-25** — T-161: editor web de productos y presentaciones por push; `barcode_rows` en la ficha; reglas de captura en `shared` (T71).
- **2026-10-25** — T-162: compras web (lista, detalle, editor, Inicio); búsqueda con último precio en la tienda; el upsert acepta filas parciales y tombstones (T72, T73).
- **2026-10-25** — T-164: precio de anaquel web con foto y escaneo con zxing en anaquel, compras, editor de productos y catálogo (T74).
- **2026-10-25** — T-165: administración web (usuarios, fusión con vista previa `dry_run`, gasto de IA) (T75).
- **2026-10-25** — T-166: cuenta web (datos, cambiar contraseña con reautenticación, cerrar sesión); hallazgo de Android con sesión de Google (T76).
