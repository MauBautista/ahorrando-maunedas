# 05 · Android

Requisitos: RF-AUTH, RF-CAT, RF-COM, RF-TIC, RF-PRE, RF-SYN, RF-IMG (E1); RF-TRK y RF-ALR (E2). RNF-01, 04, 07, 08.

## 1. Plataforma

| Tema | Decisión |
|---|---|
| Lenguaje / UI | Kotlin 2.x, Jetpack Compose, Material 3 |
| `applicationId` | `com.maubautista.maunedas` |
| `minSdk` / `targetSdk` | 26 / última estable |
| DI | Hilt (+ `hilt-work`) |
| Persistencia | Room (KSP), DataStore (sesión y preferencias), archivos en `filesDir/images/` |
| Red | Retrofit + OkHttp + kotlinx.serialization |
| Trabajo en segundo plano | WorkManager |
| Imágenes | Coil 3 (con `AuthInterceptor` para rutas `/v1/images/*`) |
| Gráficas | Vico (Compose) |
| Cámara y ML | CameraX; ML Kit Barcode Scanning (modelo **empaquetado**, funciona offline desde la primera vez); ML Kit Document Scanner; ML Kit Subject Segmentation (beta, opcional en E1) |
| Auth | Firebase Auth, Credential Manager + `googleid` |
| Push | Firebase Cloud Messaging (E2) |
| Fechas | `java.time` con zona `America/Mexico_City` |
| Distribución | Firebase App Distribution; keystore de release propio (SHA-1/SHA-256 registrados en Firebase) |
| Variantes de build | `dev` (Worker `maunedas-dev`) y `prod` |

Versiones en `gradle/libs.versions.toml`; ninguna versión escrita en los `build.gradle.kts`.

## 2. Módulos

```
apps/android/
├── app/                       Application, MainActivity, NavHost, deep links, DI raíz
├── core/
│   ├── model/                 Modelos de dominio puros, Usernames, Uuids (v7 y v5, 04 §2.1), Money
│   ├── pricing/               Units, Promotions, SearchKey, QuantityParser (fixtures compartidos)
│   ├── database/              Room: entidades, DAOs, vistas, AppDatabase, migraciones
│   ├── network/               Retrofit APIs, DTOs, AuthInterceptor, TokenAuthenticator, manejo de errores
│   ├── auth/                  AuthRepository, SessionStore, DeviceRegistrar
│   ├── sync/                  LocalWriter, SyncTables, SyncWorker, PullApplier, ConflictHandler, UploadWorker
│   ├── data/                  Repositorios de dominio (catálogo, compras, precios, imágenes, tickets)
│   ├── camera/                CameraX + ML Kit (códigos, documentos, segmentación)
│   ├── designsystem/          Tema generado desde tokens, componentes (MoneyField, QuantityField, StorePicker…)
│   └── ui/                    Utilidades Compose, formateadores es-MX
└── feature/
    ├── auth/                  S-01
    ├── home/                  S-02
    ├── purchases/             S-03 a S-06
    ├── catalog/               S-07 a S-10
    ├── scan/                  S-11, S-12
    ├── shelf/                 S-13
    ├── photo/                 S-18
    ├── settings/              S-15 a S-17
    └── tracking/              S-20 a S-23 (E2)
```

Dependencias permitidas: `feature → core:*`; `core:data → core:database, core:network, core:sync, core:pricing, core:model`; ningún `core` depende de `feature`.

## 3. Arquitectura de UI

- Flujo unidireccional: `ViewModel` expone `StateFlow<XxxUiState>`; la pantalla llama funciones del ViewModel; efectos de una vez (navegar, snackbar) por `Channel`.
- Los repositorios exponen `Flow` desde Room. Las escrituras pasan por `LocalWriter` (`04-sincronizacion.md` §6.2).
- La red solo se usa en: login, lookup de código en catálogo, extracción de ticket, resolución de URL (E2) y los Workers.
- Listas largas (compras, catálogo) con Paging 3 sobre Room.
- Navegación con rutas tipadas (`@Serializable` routes) en Navigation Compose.

```kotlin
@HiltViewModel
class PurchaseEditorViewModel @Inject constructor(
    savedState: SavedStateHandle,
    private val purchases: PurchaseRepository,
    private val prices: PriceRepository,
    private val calc: PurchaseCalculator,
) : ViewModel() {
    private val route = savedState.toRoute<PurchaseEditorRoute>()
    private val draft = MutableStateFlow<PurchaseDraft?>(null)

    val state: StateFlow<PurchaseEditorUiState> = draft
        .filterNotNull()
        .map { d -> PurchaseEditorUiState(draft = d, totals = calc.totals(d), canConfirm = calc.canConfirm(d)) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), PurchaseEditorUiState.Loading)

    init {
        viewModelScope.launch { draft.value = purchases.loadOrCreateDraft(route.purchaseId) }
    }

    fun onLineSaved(line: LineDraft) = updateDraft { it.upsertLine(line) }
    fun onConfirm() = viewModelScope.launch { purchases.confirm(requireNotNull(draft.value)) }
    // …
}
```

## 4. Navegación

Barra inferior: **Inicio · Compras · Escanear · Catálogo · Ajustes**. En E2 se agrega **Seguimiento** dentro de Catálogo (pestaña) para no pasar de cinco destinos.

```
Login ─► Inicio ─┬─► Compras ─► Editor de compra ─┬─► Editor de línea (sheet)
                 │                                 ├─► Escáner continuo
                 │                                 ├─► Escáner de documentos ─► Revisión de ticket
                 │                                 └─► Selector de tienda (sheet)
                 ├─► Escanear ─► Resultado (sheet) ─┬─► Ficha de producto
                 │                                  ├─► Nuevo producto
                 │                                  └─► Precio de anaquel
                 ├─► Catálogo ─► Ficha de producto ─┬─► Editor de producto / variante
                 │                                  ├─► Foto de producto
                 │                                  └─► (E2) Listings y alertas
                 └─► Ajustes ─► Estado de sync · Cambios rechazados · Cuenta
```

Deep links: `maunedas://variant/{id}` (alertas, E2), `maunedas://purchase/{id}`.

## 5. Pantallas

### S-01 Login — ver `02-autenticacion.md` §6.1

### S-02 Inicio
- Acciones grandes: **Nueva compra**, **Foto de ticket**, **Precio de anaquel**, **Escanear**.
- "Compras recientes" (5) con tienda, fecha, total y estado.
- "Gasto del mes": suma de `total_cents` (o suma de líneas si no hay total) de compras confirmadas del mes en curso.
- Aviso si hay borradores abiertos o cambios rechazados; indicador discreto si hay pendientes de sincronizar.

### S-03 Compras
- Lista paginada agrupada por día: tienda (+ sucursal), hora, total, número de líneas, chip "Borrador".
- Filtros: tienda, rango de fechas, estado.
- Vacío: "Aún no hay compras. Toca + para registrar la primera."

### S-04 Editor de compra (RF-COM-01 a 09, RF-TIC-01)
Encabezado:
- Tienda (obligatoria, S-14), sucursal (opcional), fecha y hora (por defecto ahora).

Líneas (lista reordenable por `line_no`):
- `Producto · Variante` · `cantidad × precio` · chip de promoción · **total de línea** · precio por unidad en gris ("$26.50 / L").
- Líneas sin vincular (de ticket) en ámbar con "Vincular".
- Deslizar para borrar (con deshacer).

Pie (fijo):
- Suma de líneas, descuentos de ticket (editable, lista), **total calculado**, campo **Total del ticket**, diferencia en rojo si > $1.00 (RF-COM-06).

Acciones:
- `+ Línea` (buscar), `Escanear` (modo continuo, RF-COM-09), `Foto de ticket` (escáner de documentos), `Extraer` (visible si hay fotos de ticket y red), `Guardar borrador`, `Confirmar`.
- Confirmar exige tienda y ≥ 1 línea; si hay diferencia de total, diálogo "El total no cuadra por $X. ¿Confirmar de todos modos?".
- Autoguardado del borrador al salir.

### S-05 Editor de línea (bottom sheet)
- Variante: búsqueda por texto o código; cada resultado muestra el último precio en **esta** tienda.
- Cantidad: stepper entero; si la variante es a granel, campo decimal "kg" con 3 decimales.
- Precio unitario de lista: se prellena con el último precio de esa variante en esa tienda.
- Promoción: selector de tipo y parámetros; el descuento se calcula con `Promotions.discount()` y se puede sobrescribir a mano (queda `type='other'` si se sobrescribe).
- Total de línea calculado; precio efectivo por unidad en vivo.
- Botones: "Guardar" y "Guardar y otra".

### S-06 Revisión de ticket (RF-TIC-02 a 06) — lógica en `09-ia-y-tickets.md` §5
- Encabezado con tienda detectada (cambiable), fecha detectada, total del ticket.
- Cada línea con estado: ✓ vinculada · ? sugerida (toca para aceptar una de las sugerencias) · ! sin vincular (buscar o crear producto) · — no es producto.
- Barra: "12 de 40 pendientes". Botón **Confirmar compra** habilitado cuando no quedan pendientes (las "no es producto" cuentan como resueltas).
- Al confirmar: escribe la compra, sus líneas, promociones y los alias nuevos en una transacción.

### S-07 Catálogo
- Buscador (usa `search_key` local) y filtros por categoría (árbol) y etiqueta.
- Tarjeta: miniatura, nombre, marca, número de presentaciones, **mejor precio por unidad** con tienda y antigüedad ("hace 3 días") (RF-PRE-05).

### S-08 Ficha de producto
Pestañas:
1. **Presentaciones**: cada variante con foto, contenido ("6 × 1 L"), códigos, último precio por tienda, precio por unidad.
2. **Comparar**: tabla variante × tienda con último / mínimo / promedio 90 d por unidad; celda más barata resaltada (RF-PRE-04).
3. **Historial**: selector de variante; gráfica con puntos de compra y anaquel y línea escalonada web (E2); filtros por fuente y tienda (RF-PRE-02).
4. **Seguimiento** (E2): listings y reglas de alerta.
- Acciones: editar, agregar variante, agregar foto, registrar precio de anaquel, (admin) eliminar o fusionar.

### S-09 Editor de producto
Nombre, marca, categoría (árbol), etiquetas (chips con alta rápida), unidad de despliegue (sugerida por la medida de la primera variante), notas.

### S-10 Editor de variante
- Etiqueta (se sugiere a partir del contenido: "1 L", "6 × 1 L").
- Medida: Masa / Volumen / Piezas.
- Asistente de contenido: `[pack_count] × [cantidad] [unidad]` con unidades g, kg, ml, L, pz → se guarda en unidad base.
- "Se vende a granel" (solo masa; fija `unit_amount = 1000`, `pack_count = 1`).
- Códigos: lista + "Escanear código".

### S-11 Escáner
- Vista de cámara (CameraX `PreviewView` + `ImageAnalysis`) con ML Kit; formatos EAN-13, EAN-8, UPC-A, UPC-E, Code 128.
- Linterna, vibración y sonido corto al leer. Ignora el mismo código durante 2 s.
- Modo continuo (desde el editor de compra): cada lectura crea una línea y abre el campo de precio.

### S-12 Resultado del escaneo (sheet)
1. Código normalizado → `barcodes` local.
2. **Encontrado**: producto y variante, últimos precios; acciones "Agregar a la compra abierta", "Precio de anaquel", "Ver ficha".
3. **No encontrado y hay red**: `GET /v1/barcodes/:code`.
   - `match` (existe en el servidor pero no ha bajado): lanza pull y muestra el resultado.
   - `catalog`: "Nuevo producto" prellenado (nombre, marca, contenido interpretado, foto). Antes de crear, pregunta "¿Es otra presentación de un producto que ya tienes?" con búsqueda por nombre.
4. **Sin red o sin datos**: "Nuevo producto" vacío con el código ya asignado.

### S-13 Precio de anaquel (RF-PRE-01)
Variante (buscar/escanear), tienda y sucursal (recuerda la última), precio, promoción opcional (mismo selector que S-05, calcula `effective_price_cents`), foto opcional del anaquel. Guarda `price_observations` con `source='shelf'`, `observed_at = ahora`.

### S-14 Selector de tienda (sheet)
Tiendas ordenadas por uso reciente; buscador; "Nueva tienda" (nombre, tipo). Sucursales de la tienda con "Nueva sucursal" (nombre, ciudad; por defecto Puebla o San Pedro Cholula según lo último usado).

### S-15 Ajustes
Cuenta (nombre, usuario, cambiar contraseña), Sincronización (S-16), Almacenamiento (tamaño de fotos locales), Acerca de (versión, esquema). Cerrar sesión (`02-autenticacion.md` §6.4).

### S-16 Estado de sincronización (RF-SYN-04)
Última sincronización, cambios pendientes (por tabla), subidas pendientes, errores recientes, botón "Sincronizar ahora", lista "Cambios rechazados" (`sync_issues`).

### S-17 Conflicto de código (diálogo) — `04-sincronizacion.md` §6.5

### S-18 Foto de producto (RF-IMG-02, 03)
Cámara o galería → reducir a ≤ 2048 px (JPEG 85) → (opcional E1) quitar fondo en el teléfono → vista previa con interruptor "Sin fondo" → guardar. Flujo técnico en `10-imagenes.md` §4–5.

### E2 · S-20 a S-23
- **S-20 Seguimiento**: listings de la variante con tienda, último precio, última revisión, estado, intervalo; "Revisar ahora".
- **S-21 Agregar URL**: campo URL (o llega por *Compartir* desde el navegador o la app de la tienda: `intent-filter` `ACTION_SEND` `text/plain`) → `POST /v1/listings/resolve` → seleccionar variante → guardar listing por sync.
- **S-22 Reglas de alerta**: tipo, umbral, alcance, silencio (horas), activa.
- **S-23 Historial de alertas**: lista de `alert_events` con enlace a la variante.

## 6. Cálculos compartidos (`core:pricing`)

Implementaciones Kotlin que pasan los fixtures de `fixtures/`:

| Clase | Fixture | Uso |
|---|---|---|
| `Units` | `normalizacion.json` | Precio por unidad |
| `Promotions` | `promociones.json` | Descuento de línea por tipo de promoción |
| `SearchKey` | `textos.json` (`search_key`) | Búsqueda sin acentos |
| `ReceiptText` | `textos.json` (`raw_text_norm`) | Normalización de líneas de ticket (alias) |
| `QuantityParser` | `cantidades.json` | Interpretar "6 x 1 l" del catálogo abierto |
| `Usernames` | `usuarios.json` | Correo sintético |
| `Uuids` (`core:model`) | `ids.json` | UUIDv7 e ids deterministas de `product_tags` y `receipt_aliases` |

```kotlin
object Promotions {
    /** Descuento en centavos para una línea. quantity entero salvo percent/price_cut/coupon. */
    fun discount(type: PromoType, params: PromoParams, quantity: Double, unitPriceCents: Long): Long = when (type) {
        PromoType.PRICE_CUT -> ((params.fromCents!! - params.toCents!!) * quantity).roundHalfUp()
        PromoType.PERCENT -> (unitPriceCents * quantity * params.percent!! / 100.0).roundHalfUp()
        PromoType.NXM -> {
            val n = params.n!!; val m = params.m!!
            (floor(quantity / n) * (n - m) * unitPriceCents).toLong()
        }
        PromoType.NTH_UNIT_DISCOUNT ->
            (floor(quantity / params.nth!!) * unitPriceCents * params.percent!! / 100.0).roundHalfUp()
        PromoType.MEMBER_PRICE -> ((unitPriceCents - params.memberCents!!) * quantity).roundHalfUp()
        PromoType.COUPON -> params.amountCents ?: (unitPriceCents * quantity * params.percent!! / 100.0).roundHalfUp()
        PromoType.MSI -> 0
        PromoType.BUNDLE, PromoType.OTHER -> params.amountCents ?: 0
    }
}
```

Redondeo: *half-up* a centavo con `roundHalfUp(x) = floor(x + 0.5)` (igual que `Math.round` de JS/Java). Nunca `kotlin.math.round` ni `roundToLong()` sobre `Double` sin revisar: `round` redondea a par y rompe la paridad con TS (09 §6.1). Las fórmulas exactas, el acotamiento a `[0, bruto]` y los nombres de función siguen `packages/shared/src/pricing/promotions.ts`.

## 7. Formato y accesibilidad

- Moneda: `NumberFormat.getCurrencyInstance(Locale("es", "MX"))` → `$1,234.50`.
- Fechas: `d MMM yyyy` (`30 sep 2026`), hora `HH:mm`.
- Teclado numérico decimal en precios y cantidades; el campo de precio acepta "28.5" y "28,5".
- Objetivos táctiles ≥ 48 dp; prueba con escala de fuente 200 % sin textos cortados (RNF-08).
- Descripciones de contenido en íconos de acción; contraste AA en tema claro y oscuro.

## 8. Permisos y manifiesto

| Permiso | Motivo |
|---|---|
| `INTERNET`, `ACCESS_NETWORK_STATE` | API y WorkManager |
| `CAMERA` | Escáner de códigos y fotos (el escáner de documentos de ML Kit no lo requiere) |
| `POST_NOTIFICATIONS` (API 33+) | Alertas (E2), se pide al crear la primera regla |

```xml
<meta-data android:name="com.google.mlkit.vision.DEPENDENCIES" android:value="subject_segment" />
```
(Solo si se activa el recorte en el dispositivo; descarga el modelo de segmentación al instalar.)

## 9. Pruebas (detalle en `11-pruebas.md`)

- Unit: `core:pricing` contra fixtures; ViewModels con Turbine; `PurchaseCalculator`.
- Room: DAOs y `PullApplier` con base en memoria (Robolectric).
- Red: `MockWebServer` para `SyncWorker` (conflictos, `BATCH_REJECTED`, 401 → refresh → reintento).
- UI: Compose tests del editor de compra (totales, validación de confirmación).
