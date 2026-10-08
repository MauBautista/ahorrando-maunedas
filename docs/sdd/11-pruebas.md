# 11 · Pruebas

Requisito: RNF-10. Cada tarea de `12-tareas.md` indica qué pruebas debe dejar funcionando.

## 1. Estrategia

| Nivel | Herramienta | Qué cubre |
|---|---|---|
| Reglas compartidas | Vitest (TS), JUnit (Kotlin), pytest (Python) contra `fixtures/` | Normalización, promociones, textos, cantidades, usuarios |
| Worker | Vitest 4 + `@cloudflare/vitest-plugin` (antes `vitest-pool-workers`, ya deprecado): `cloudflareTest()` en `vitest.config.ts`, `env`/`exports` de `cloudflare:workers`, D1 y R2 locales con las migraciones reales vía `readD1Migrations`/`applyD1Migrations` | Sync, auth, alertas, ingesta, presupuesto de IA, imágenes |
| Android | JUnit + Turbine; Robolectric para Room; MockWebServer; Compose UI tests | Repositorios, `SyncWorker`, `PullApplier`, editor de compra |
| Web | Vitest + Testing Library | Formularios y pantallas con lógica |
| Agente | pytest con HTML guardado | Adapters, scheduler, dinero, JSON-LD |
| Manual | Checklists §5 y §6 | Flujos completos, offline, iPhone |
| Spikes | Protocolos §7 | Decisiones abiertas |

Servicios externos (Firebase, Google OAuth, FCM, OpenRouter, Open Food Facts, tiendas) **siempre simulados** en pruebas automáticas.

## 2. Fixtures compartidos

| Archivo | Contenido | Lo consumen |
|---|---|---|
| `fixtures/normalizacion.json` | Precio por unidad y unidad de despliegue | shared, Android, agente |
| `fixtures/promociones.json` | Descuento por tipo; detección desde texto | shared, Android |
| `fixtures/textos.json` | `search_key` y `raw_text_norm` | shared, Android |
| `fixtures/cantidades.json` | `parseQuantity` y etiqueta sugerida | shared, Android |
| `fixtures/usuarios.json` | Usuario → correo sintético | shared, Android |
| `fixtures/ids.json` | Namespaces y vectores UUIDv5 (`product_tags`, `receipt_aliases`, 04 §2.1) | shared, Android |

En TS, `packages/shared/test/coverage.test.ts` falla si un archivo de `fixtures/` no tiene suite. Cada suite valida la forma del fixture con Zod antes de usarlo.

Regla: si una implementación no pasa un fixture, se corrige la implementación. Un fixture solo cambia cuando cambia la regla del SDD (y ambos en el mismo cambio).

Carga desde Kotlin (los fixtures se copian a `src/test/resources` con una tarea de Gradle):

```kotlin
class UnitsFixtureTest {
    private val cases = Json.decodeFromString<NormalizationFixture>(resource("normalizacion.json")).casos

    @Test fun matchesSharedVectors() = cases.forEach { c ->
        val cpb = Units.centsPerBase(c.paidCents, c.quantity, c.variante.unitAmount, c.variante.packCount)
        assertEquals(c.esperado.centsPerBase, cpb, 1e-9, c.nombre)
        c.esperado.display.forEach { (unit, cents) ->
            assertEquals(cents, Units.displayCents(cpb, c.variante.measure, DisplayUnit.of(unit)), c.nombre)
        }
    }
}
```

## 3. Casos clave por componente

Las tablas de casos viven junto a su diseño:

| Componente | Ver |
|---|---|
| Autenticación | `02-autenticacion.md` §9 |
| Sincronización | `04-sincronizacion.md` §8 |
| Agente | `07-agente.md` §14 |
| Alertas | `08-alertas.md` §8 |
| Tickets | `09-ia-y-tickets.md` §4 (conversión, errores) y §9 (spike C) |
| Imágenes | `10-imagenes.md` §7 |

Adicionales del Worker:

| Caso | Esperado |
|---|---|
| `X-Client-Schema` menor que `MIN_CLIENT_SCHEMA` | `426 E-UPGRADE_REQUIRED` |
| Error no previsto en una ruta | `500 E-INTERNAL` con `request_id`, sin traza en el cuerpo |
| `GET /v1/products?q=cafe` con producto "Café Legal" | Lo encuentra |
| `GET /v1/products/:id/compare` con compras en 2 tiendas y 2 variantes | 4 filas; `best` = menor precio por unidad del último punto |
| `POST /v1/admin/merge` variante → variante | Reasigna todas las tablas listadas en `03-api.md` §12; origen con tombstone; todas las filas con versión nueva |
| Presupuesto: gasto 5.995 USD, estimado 0.01 | `402` |
| Presupuesto: cambio de mes a las 00:00 hora de México (06:00 UTC) | El gasto se reinicia |

## 4. Integración continua

Fuente de verdad: [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml). Corre en cada `push` y `pull_request`, cancela corridas viejas de la misma rama y tiene permisos de solo lectura.

| Job | Pasos |
|---|---|
| `ts` | `pnpm/action-setup` (versión de `packageManager`) → `setup-node` con `.nvmrc` → `pnpm install --frozen-lockfile` → `pnpm format:check` → `pnpm lint` → `pnpm typecheck` → `pnpm tokens && git diff --exit-code` (tokens generados al día) → `pnpm --filter web build` (antes de los tests: cuando el Worker sirva `apps/web/dist`, sus tests lo necesitan) → `pnpm test` |
| `android` | `setup-java` (Temurin 17) → `gradle/actions/setup-gradle` (valida el wrapper) → `./gradlew testDevDebugUnitTest lintDevDebug`. Desde T-100 escribe `app/src/dev/google-services.json` desde el secreto `GOOGLE_SERVICES_JSON_DEV` mediante una variable de entorno (no con `echo '${{ … }}'`) |
| `agent` | `astral-sh/setup-uv` (fijada por SHA: ya no publica etiquetas de versión mayor) → `uv sync --frozen` → `ruff check` → `ruff format --check` → `pytest` |

Versiones de acciones (2026-10): `actions/checkout@v7`, `actions/setup-node@v7`, `pnpm/action-setup@v6`, `actions/setup-java@v6`, `gradle/actions/setup-gradle@v6`, `astral-sh/setup-uv` v10.2.0 por SHA.

Despliegue: manual en E1 (`pnpm --filter api deploy`). Automatizar solo cuando el flujo esté estable.

## 5. Checklist manual — cierre de Etapa 1

Dos teléfonos Android (A y B), una computadora y un iPhone.

**Acceso**
- [ ] Admin da de alta a un miembro con usuario/contraseña y correo de Google.
- [ ] El miembro entra con contraseña en A y con Google en B; en ambos es el mismo usuario.
- [ ] Una cuenta de Google no registrada ve el mensaje correcto y queda sin sesión.
- [ ] Login con Google en Safari de iPhone.
- [ ] Admin restablece la contraseña; la vieja deja de funcionar.

**Offline (A en modo avión)**
- [ ] La app abre sin red directo en Inicio.
- [ ] Escanear un código nuevo → crear producto y variante manualmente.
- [ ] Nueva compra de ≥ 10 líneas con: 2x1, segunda al 50 %, producto a granel, cupón de ticket.
- [ ] Foto de ticket de 2 páginas adjunta al borrador.
- [ ] Precio de anaquel con foto.
- [ ] Quitar modo avión: todo sube; B lo ve en ≤ 1 min con la app abierta.

**Conflictos**
- [ ] A y B sin red editan la misma compra; al reconectar gana la última edición y el otro ve el aviso.
- [ ] A y B asignan el mismo código a variantes distintas: aparece la resolución `BARCODE_TAKEN` y ambas opciones funcionan.

**Tickets**
- [ ] Extraer un ticket de 30+ líneas; revisar; confirmar.
- [ ] Siguiente compra en la misma tienda: las líneas repetidas se vinculan solas.
- [ ] Extraer de nuevo el mismo ticket no cobra (`reused: true`).

**Precios**
- [ ] Ficha de "Leche": el paquete de 6 aparece más barato por litro que la pieza suelta si así fue la compra.
- [ ] Historial con puntos de compra y anaquel, filtros por tienda.
- [ ] Mejor precio por unidad visible en la lista del catálogo.

**Web / iPhone**
- [ ] Registrar una compra completa desde el iPhone con escaneo por cámara.
- [ ] Admin fusiona dos productos duplicados; los historiales quedan unidos.
- [ ] Gasto de IA del mes visible y coherente con OpenRouter.

**Accesibilidad**
- [ ] Fuente del sistema al máximo: el editor de compra y la ficha no cortan textos.

## 6. Checklist manual — cierre de Etapa 2

- [ ] Compartir una URL de Amazon desde su app → listing creado y revisado en ≤ 5 min.
- [ ] Una URL por cada tienda prioritaria (Amazon, Costco, Walmart, Sam's) con precio correcto para el CP 72750.
- [ ] Cambiar el intervalo de un listing a 4 h se refleja en el agente en ≤ 2 min.
- [ ] Regla "debajo de $X": forzar el caso con un umbral alto → notificación, toque abre la variante.
- [ ] Dos reglas del mismo usuario en la misma observación → una sola notificación.
- [ ] Apagar el agente 2 h → aviso al admin; al encenderlo, retoma sin perder resultados.
- [ ] Respaldo diario y volcado semanal presentes; `rclone` con el mismo número de objetos.
- [ ] Restauración en un D1 nuevo con conteos iguales (documentada en `ESTADO.md`).

## 7. Protocolos de spikes (Etapa 0)

| Spike | Procedimiento | Medir | Criterio |
|---|---|---|---|
| **A · rembg** | En el servidor, contenedor Python con `rembg[cpu]`; 10 fotos reales de productos; modelos `u2net`, `isnet-general-use` y uno ligero | Segundos por imagen, RSS pico, calidad 1–5 | Elegir el de mejor calidad con ≤ 60 s/imagen y ≤ 1.2 GB. Si onnxruntime no arranca en el A8 (instrucción ilegal), T2 se descarta y se registra |
| **B · Scraping** | 3 productos por tienda prioritaria; HTTP simple (JSON-LD, estado embebido, selectores) y luego Playwright | Éxito por método, tiempo, RAM de Chromium, si pide CP/sucursal | Guardar HTML como fixtures; registrar por tienda el método que funciona y los límites de memoria del contenedor |
| **C · Tickets** | `09-ia-y-tickets.md` §9 | Exactitud y costo | ≥ 95 % de importes en 4 de 5 tickets y ≤ 0.02 USD/ticket |
| **D · CPU del Worker** | En `maunedas-dev`, rutas temporales: push de 100 filas, verificación JWT, token de Google en frío, vinculación de 40 líneas contra 500 productos | Tiempo de CPU p50/p95 en Workers Logs | p95 < 8 ms en todas → plan Free; si no, Paid (D3) |
| **E · Correo sintético** | Crear `prueba@maunedas.local` por Identity Toolkit e iniciar sesión desde la web y Android | ¿Acepta Firebase el dominio? | Sí → D9 cerrada; no → probar dominio alterno y registrar |
