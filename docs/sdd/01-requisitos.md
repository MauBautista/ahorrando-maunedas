# 01 · Requisitos

Formato: **ID · requisito · etapa · criterio de aceptación**. "E1" = etapa 1 (MVP), "E2" = tracker y alertas, "E3" = ampliaciones.

## Autenticación y usuarios (`AUTH`)

| ID | Requisito | Etapa | Criterio de aceptación |
|---|---|---|---|
| RF-AUTH-01 | Iniciar sesión con **usuario y contraseña** | E1 | Con credenciales válidas se entra en Android y web; con inválidas aparece "Usuario o contraseña incorrectos" sin revelar cuál falló |
| RF-AUTH-02 | Iniciar sesión con **cuenta de Google** | E1 | Una cuenta cuyo correo está en `users.google_email` entra; cualquier otra ve "Esta cuenta de Google no está registrada" y queda sin sesión |
| RF-AUTH-03 | No hay registro público | E1 | Una cuenta de Firebase sin identidad vinculada recibe `403 E-USER_NOT_ALLOWED` en toda la API |
| RF-AUTH-04 | El admin da de alta usuarios (usuario, nombre, rol, contraseña inicial, correo de Google opcional) | E1 | El usuario nuevo puede entrar con ambos métodos configurados en ≤ 1 min tras el alta |
| RF-AUTH-05 | El admin restablece la contraseña de un usuario | E1 | La contraseña anterior deja de funcionar; la nueva funciona |
| RF-AUTH-06 | Cada usuario cambia su propia contraseña | E1 | Pide la contraseña actual; la nueva debe tener ≥ 8 caracteres |
| RF-AUTH-07 | El admin desactiva un usuario | E1 | Sus peticiones reciben `403 E-USER_DISABLED` a más tardar al expirar su token (≤ 1 h) |
| RF-AUTH-08 | La sesión persiste sin red en Android | E1 | Con modo avión, la app abre directo en Inicio si hubo sesión previa |
| RF-AUTH-09 | Cerrar sesión | E1 | Si hay cambios sin sincronizar, advierte con el número pendiente antes de borrar datos locales |

## Catálogo (`CAT`)

| ID | Requisito | Etapa | Criterio de aceptación |
|---|---|---|---|
| RF-CAT-01 | Crear, editar y buscar productos (nombre, marca, categoría, etiquetas, unidad de despliegue, notas) | E1 | Búsqueda por nombre o marca sin acentos ni mayúsculas devuelve coincidencias parciales |
| RF-CAT-02 | Variantes por producto con medida (masa, volumen, pieza), contenido por unidad, número de unidades por paquete y opción "a granel" | E1 | "6 × 1 L" se captura con un asistente y se guarda como `unit_amount=1000`, `pack_count=6` |
| RF-CAT-03 | Uno o varios códigos de barras por variante; un código pertenece a una sola variante | E1 | Asignar un código ya usado muestra a qué variante pertenece y ofrece fusionar |
| RF-CAT-04 | Categorías jerárquicas | E1 | Filtrar por "Refrigerados" incluye productos de "Refrigerados › Lácteos" |
| RF-CAT-05 | Etiquetas libres | E1 | Se pueden asignar varias etiquetas y filtrar por ellas |
| RF-CAT-06 | Buscar un código en catálogos abiertos (Open Food Facts, Open Products Facts, Open Beauty Facts) | E1 | Para un código conocido por el catálogo, se prellenan nombre, marca, contenido y foto |
| RF-CAT-07 | Fusionar productos o variantes duplicados (solo admin) | E1 | Tras fusionar, compras, precios, códigos, listings, reglas y alias apuntan al destino; el origen queda eliminado |
| RF-CAT-08 | Eliminar productos, variantes, tiendas y categorías (solo admin) | E1 | Un miembro no ve la opción; si la fuerza, el servidor rechaza con `E-FORBIDDEN` |

## Compras (`COM`)

| ID | Requisito | Etapa | Criterio de aceptación |
|---|---|---|---|
| RF-COM-01 | Registrar una compra completa: tienda, sucursal opcional, fecha y hora, líneas | E1 | Una compra de 40 líneas se guarda sin errores y aparece en la lista |
| RF-COM-02 | Líneas con cantidad, precio unitario de lista, descuento y total pagado | E1 | `final = bruto − descuento` siempre; la UI no permite guardar si no cuadra |
| RF-COM-03 | Promociones por línea: rebaja, porcentaje, NxM (2x1, 3x2), N-ésima unidad con descuento, precio de socio, cupón, MSI, otra | E1 | El descuento se calcula solo según `fixtures/promociones.json`; MSI no altera el precio |
| RF-COM-04 | Productos a granel con cantidad en kg | E1 | 0.845 kg × $32.90/kg = $27.80 |
| RF-COM-05 | Descuentos a nivel ticket | E1 | Se guardan en la compra y se prorratean al calcular precio efectivo por unidad |
| RF-COM-06 | Validación contra el total del ticket | E1 | Si Σ líneas − descuentos de ticket difiere del total capturado en más de $1.00, se muestra la diferencia y se pide confirmar |
| RF-COM-07 | Estados borrador y confirmada | E1 | Solo las confirmadas entran en historiales y comparadores |
| RF-COM-08 | Editar y eliminar compras | E1 | Cualquier usuario puede; queda auditado en `updated_by` |
| RF-COM-09 | Agregar líneas escaneando códigos en modo continuo | E1 | Cada escaneo agrega una línea y enfoca el campo de precio |

## Tickets (`TIC`)

| ID | Requisito | Etapa | Criterio de aceptación |
|---|---|---|---|
| RF-TIC-01 | Fotografiar un ticket (1 a 4 páginas) y adjuntarlo a una compra en borrador, sin red | E1 | La foto queda guardada localmente y se sube al volver la red |
| RF-TIC-02 | Extraer el ticket automáticamente | E1 (si spike C aprueba) | Devuelve tienda, fecha, líneas, descuentos y total; el costo se registra |
| RF-TIC-03 | Vincular líneas automáticamente por alias aprendidos y códigos impresos | E1 | Una línea vinculada una vez en una tienda se vincula sola en la siguiente compra de esa tienda |
| RF-TIC-04 | Revisar y corregir antes de confirmar | E1 | Cada línea muestra estado (vinculada, sugerida, sin vincular, no es producto) |
| RF-TIC-05 | Al confirmar, aprender alias de las líneas vinculadas manualmente | E1 | Se crea un `receipt_alias` por línea nueva |
| RF-TIC-06 | No repetir el costo de extracción del mismo ticket | E1 | Pedir la extracción dos veces de las mismas fotos devuelve el resultado guardado salvo `force=true` |

## Precios (`PRE`)

| ID | Requisito | Etapa | Criterio de aceptación |
|---|---|---|---|
| RF-PRE-01 | Capturar precio de anaquel (variante, tienda, sucursal, precio, promo, foto opcional) | E1 | Queda como observación `shelf` con la hora actual |
| RF-PRE-02 | Historial por variante con tres fuentes: pagado, anaquel, web | E1 (web en E2) | Gráfica con filtros por fuente y tienda; web se dibuja en escalones |
| RF-PRE-03 | Precio normalizado por unidad | E1 | Coincide con `fixtures/normalizacion.json` en Android, web y agente |
| RF-PRE-04 | Comparador variante × tienda con último, mínimo y promedio de 90 días por unidad | E1 | Se resalta la opción más barata por unidad |
| RF-PRE-05 | Mejor precio por unidad visible en listas de catálogo | E1 | Muestra valor, tienda y antigüedad del dato |

## Sincronización (`SYN`)

| ID | Requisito | Etapa | Criterio de aceptación |
|---|---|---|---|
| RF-SYN-01 | Todo registro en Android funciona sin red | E1 | En modo avión se crean producto, compra con fotos y precio de anaquel |
| RF-SYN-02 | Sincronización automática al recuperar red y cada 15 min | E1 | Los cambios aparecen en otro dispositivo ≤ 1 min después de recuperar red (con la app abierta) |
| RF-SYN-03 | Conflictos visibles | E1 | Si otro dispositivo ganó, se avisa qué registro cambió |
| RF-SYN-04 | Estado de sincronización visible | E1 | Ajustes muestra pendientes, errores y última sincronización; botón "Sincronizar ahora" |

## Imágenes (`IMG`)

| ID | Requisito | Etapa | Criterio de aceptación |
|---|---|---|---|
| RF-IMG-01 | Usar la foto del catálogo abierto como foto del producto | E1 | Se guarda con licencia y atribución visibles en la ficha |
| RF-IMG-02 | Tomar foto propia del producto | E1 | Se guarda optimizada (≤ 2048 px) y se sube en segundo plano |
| RF-IMG-03 | Quitar el fondo en el teléfono | E1 (opcional) | Resultado en < 2 s en un teléfono de gama media, sin red |
| RF-IMG-04 | Mejorar la foto en el servidor casero | E3 | Llega una versión nueva sin pisar ediciones manuales |
| RF-IMG-05 | Editor: recorte, rotación, fondo, brillo/contraste, pincel de máscara | E3 | La edición es reversible (original intacto) |
| RF-IMG-06 | Edición generativa con IA | E3 | Muestra costo estimado y pide confirmación |

## Tracking (`TRK`)

| ID | Requisito | Etapa | Criterio de aceptación |
|---|---|---|---|
| RF-TRK-01 | Vincular una URL de Amazon, Costco, Walmart o Sam's a una variante (pegar o compartir) | E2 | Enlaces cortos (`amzn.to`, `a.co`) se resuelven a la URL canónica |
| RF-TRK-02 | Intervalo de revisión configurable por listing (default por tienda) | E2 | Cambiar a 4 h se refleja en el agente en ≤ 2 min |
| RF-TRK-03 | Revisar ahora | E2 | Se revisa en ≤ 5 min si el agente está en línea |
| RF-TRK-04 | Estado del listing | E2 | Muestra último precio, última revisión, estado (ok, bloqueado, error, no encontrado) |
| RF-TRK-05 | Historial web por listing | E2 | Solo se guarda un punto cuando cambia precio, stock o promo |

## Alertas (`ALR`)

| ID | Requisito | Etapa | Criterio de aceptación |
|---|---|---|---|
| RF-ALR-01 | Cinco tipos: bajo precio objetivo, baja porcentual, mínimo histórico, regreso a stock, promoción | E2 | Cada tipo pasa la tabla de casos de `08-alertas.md` |
| RF-ALR-02 | Regla por variante (cualquier tienda) o por listing | E2 | — |
| RF-ALR-03 | Periodo de silencio por regla | E2 | No se repite la misma regla dentro de `cooldown_hours` |
| RF-ALR-04 | Notificación push en Android | E2 | Llega ≤ 5 min después de ingerir la observación |
| RF-ALR-05 | Historial de alertas y enlace directo a la variante | E2 | Tocar la notificación abre la ficha de la variante |

## Administración (`ADM`)

| ID | Requisito | Etapa | Criterio de aceptación |
|---|---|---|---|
| RF-ADM-01 | Gestión de usuarios (RF-AUTH-04, 05, 07) desde la web | E1 | Solo visible para admin |
| RF-ADM-02 | Ver gasto de IA del mes | E1 | Total, por propósito y porcentaje del tope |
| RF-ADM-03 | Ver estado del agente casero | E2 | Último heartbeat, cola, tiendas bloqueadas |

## Respaldos (`BAK`)

| ID | Requisito | Etapa | Criterio de aceptación |
|---|---|---|---|
| RF-BAK-01 | Espejo diario de la base en el servidor casero | E2 | Conteo de filas igual a D1 tras la corrida |
| RF-BAK-02 | Volcado semanal comprimido con rotación de 8 | E2 | Existen ≤ 8 archivos, el más reciente < 8 días |
| RF-BAK-03 | Copia diaria de R2 | E2 | Mismo número de objetos |
| RF-BAK-04 | Procedimiento de restauración probado | E2 | Documentado en `ESTADO.md` con fecha |

## No funcionales

| ID | Requisito | Criterio |
|---|---|---|
| RNF-01 | Offline-first en Android | La UI nunca espera a la red para mostrar o guardar |
| RNF-02 | Independencia del servidor casero | Con el agente apagado, E1 funciona completo |
| RNF-03 | Costo | IA ≤ 6 USD/mes con corte duro; Cloudflare Free salvo decisión D3 |
| RNF-04 | Rendimiento | Pantallas de Android cargan desde Room en < 300 ms; push de 100 filas < 2 s; páginas web interactivas < 2 s en 4G |
| RNF-05 | Seguridad | Sin endpoints sin auth salvo `health`, `bootstrap` (una vez) y el proxy de auth; secretos fuera del repo; R2 privado |
| RNF-06 | Privacidad | Solo salen a terceros: fotos de tickets a OpenRouter (al extraer), códigos de barras a Open Food Facts, URLs de tiendas desde el agente |
| RNF-07 | Idioma y formato | Español de México; moneda `$1,234.50`; fechas `30 sep 2026`; hora de 24 h |
| RNF-08 | Accesibilidad | Objetivos táctiles ≥ 48 dp, contraste AA, soporte de fuente grande del sistema sin cortes |
| RNF-09 | Observabilidad | Todo error del Worker se registra con `request_id`; el agente reporta salud en cada sondeo |
| RNF-10 | Mantenibilidad | Toda regla de cálculo compartida tiene fixture; cobertura de tests en sync y alertas ≥ 80 % de líneas |
