# CLAUDE.md — Ahorrando Maunedas

Sistema del hogar para registrar compras, historial de precios por presentación y tienda, precio normalizado por unidad y tracker de precios web con alertas push. Cuatro usuarios. App Android nativa offline-first, web React (también la usa el iPhone), backend en Cloudflare (Worker + D1 + R2 en `maunedas.<subdominio>.workers.dev`) y un agente en el servidor casero que hace scraping, procesamiento de imágenes y respaldos. Login con usuario/contraseña o Google (Firebase Auth).

## Documentos de gobierno — léelos antes de trabajar

| Archivo | Qué es | Cuándo se modifica |
|---|---|---|
| `GOALS.md` | Qué y para qué; no-objetivos; restricciones | Solo con decisión explícita de Mauricio |
| `PLAN.md` | Etapas y avance por bloque | Marcar bloques al terminar |
| `ESTADO.md` | Dónde vamos, decisiones, riesgos, bitácora | **Leer al iniciar cada sesión y actualizar al terminarla** |
| `docs/sdd/` | **Especificación para implementar**: requisitos, contratos, diseño por módulo, pruebas y tareas `T-xxx` | Junto con el código que cambia |
| `docs/sdd/12-tareas.md` | Tareas con dependencias y criterios de aceptación | Marcar cada tarea al terminarla |
| `docs/ARQUITECTURA.md` | Vista general; si difiere del SDD, manda el SDD | Cuando cambie un flujo |
| `docs/esquema-d1.sql` | Diseño del modelo de datos | Con cada cambio de esquema |
| `fixtures/*.json` | Vectores de prueba compartidos | Solo cuando cambia la regla del SDD; nunca para "arreglar" una implementación |

## Estructura del repositorio

```
ahorrando-maunedas/
├── CLAUDE.md · GOALS.md · PLAN.md · ESTADO.md
├── docs/                    ARQUITECTURA.md, esquema-d1.sql, sdd/
├── fixtures/                vectores compartidos TS / Kotlin / Python
├── apps/
│   ├── api/                 Cloudflare Worker "maunedas" (Hono, Drizzle, D1, R2); sirve también la web
│   │   ├── src/             ver docs/sdd/03-api.md §2
│   │   ├── migrations/
│   │   └── wrangler.jsonc
│   ├── web/                 React + TypeScript + Vite
│   └── android/             Proyecto Gradle multi-módulo (ver docs/sdd/05-android.md §2)
├── packages/
│   ├── shared/              Zod (DTOs y filas), registro de sync, unidades, promociones, textos, cantidades
│   └── design-tokens/       tokens.json → CSS y Kotlin
└── agent/                   Python 3.12 (uv): scheduler, adapters, rembg, respaldos, Dockerfile
```

## Comandos

Se crean en la Etapa 0. Mantener esta lista al día.

```bash
nvm use && corepack enable pnpm             # Node 24 (.nvmrc) y pnpm de packageManager
pnpm install
pnpm lint                                   # ESLint en todo el monorepo (raíz)
pnpm format:check                           # Prettier (no toca docs/ ni fixtures/)
pnpm typecheck                              # tsc en cada paquete (api corre `wrangler types` antes)
pnpm test                                   # Vitest en cada paquete
pnpm tokens                                 # regenera tokens.css y Tokens.kt desde tokens.json
pnpm --filter api dev                       # Worker local con D1/R2 locales (secretos en apps/api/.dev.vars)
pnpm --filter api test                      # Vitest dentro de workerd con @cloudflare/vitest-plugin
pnpm --filter api db:generate               # drizzle-kit → migrations/ (se crea en T-026)
pnpm --filter api db:migrate:local          # wrangler d1 migrations apply maunedas --local (T-026)
pnpm --filter api deploy:dev                # Worker "maunedas-dev" (la web se suma en T-020)
pnpm --filter api deploy                    # Worker "maunedas" (producción; la web se suma en T-020)
pnpm --filter web dev                       # proxy de /v1 y /__ al Worker local
pnpm --filter web build
pnpm --filter shared test                   # fixtures

cd apps/android && ./gradlew testDevDebugUnitTest lintDevDebug
cd agent && uv sync && uv run ruff check . && uv run pytest
docker compose up -d maunedas-agent         # en el servidor casero (Etapa 2)
```

## Reglas no negociables

1. **Dinero** siempre en centavos `INTEGER`; nunca float. El precio por unidad base es `REAL` solo para comparar y se redondea únicamente al mostrar.
2. **Tiempos** en epoch ms UTC. Se muestran en `America/Mexico_City`.
3. **IDs** UUIDv7 generados por el cliente. `product_tags` y `receipt_aliases` usan UUIDv5 determinista (namespaces en `packages/shared`).
4. **Tablas sincronizables** tienen `created_at`, `updated_at`, `deleted_at`, `updated_by`, `version`. Nunca DELETE físico. Solo el servidor asigna `version`.
5. **Columnas que escribe el servidor no van en tablas que edita el cliente.** Usa tablas `*_state`, tablas de solo bajada o filas append-only.
6. **Cambio de esquema** = migración D1 + entidad y migración Room + `docs/esquema-d1.sql` + tests de sync, en el mismo cambio.
7. **Reglas compartidas** (precio por unidad, promociones, textos, cantidades, usuarios) viven en TS (`packages/shared`) y Kotlin (`core:pricing`, `core:model`); el agente implementa el precio por unidad. Todas pasan los `fixtures/*.json` que les corresponden. Si un test falla, se corrige la implementación, no el fixture (salvo que la regla del SDD cambie en el mismo cambio).
8. **IA** solo desde `apps/api/src/ai/`: elige proveedor y modelo por variable de entorno, verifica presupuesto antes de llamar y registra el costo en `ai_usage`. La key de OpenRouter no existe fuera del Worker.
9. **Agente** solo habla con `/agent/v1/*` usando `AGENT_TOKEN`. Nunca abre puertos ni recibe conexiones.
10. **Scraping**: respetar separación mínima por dominio, jitter y backoff. Sin rotación de proxies ni evasión de captchas. Si una tienda bloquea, se marca `blocked` y se avisa.
11. **Secretos** solo en `wrangler secret` (`GOOGLE_SERVICE_ACCOUNT`, `OPENROUTER_API_KEY`, `AGENT_TOKEN_SHA256`, `IMAGE_URL_SECRET`, `BOOTSTRAP_TOKEN` temporal), `apps/api/.dev.vars` y `agent/.env` (ambos en `.gitignore`). Nunca en código, fixtures ni logs. El Worker jamás guarda ni registra contraseñas.
12. **Android offline-first**: la UI lee solo de Room; solo los Workers de WorkManager tocan la red.
13. **Límites del plan Free de Workers**: push ≤ 100 filas, resultados del agente ≤ 20 por request, trabajo posterior a la respuesta en `ctx.waitUntil`, imágenes a la IA por URL firmada (no base64).
14. **Idioma**: UI y documentos en español de México; código, identificadores, commits y nombres de ramas en inglés.

## Cómo trabajar

- Al iniciar: lee `ESTADO.md` y toma la siguiente tarea `T-xxx` de `docs/sdd/12-tareas.md` cuyas dependencias estén hechas. Lee solo los documentos que la tarea indica.
- Una sesión = una tarea (o pocas relacionadas). No se empieza una tarea nueva con la anterior a medias.
- Si el SDD no cubre algo o está mal, propón el cambio al SDD antes de codificar en contra de él.
- Tests obligatorios:
  - API: Vitest con D1 local (sync, alertas, presupuesto de IA).
  - Android: unit tests de repositorios con Room en memoria; tests de reglas con los fixtures.
  - Agente: `pytest` con fixtures HTML por adapter.
- Al terminar una sesión:
  1. Marca la tarea en `docs/sdd/12-tareas.md` (y el bloque en `PLAN.md` si se completó).
  2. Actualiza `ESTADO.md`: Hecho, En curso, Siguiente, y una línea en Bitácora.
  3. Si cambió una decisión, regístrala en "Decisiones tomadas" con su motivo; si era una decisión abierta, muévela.
- Ante una ambigüedad de producto, pregunta; ante una técnica con opción convencional, elige, documenta en `ESTADO.md` y sigue.

## Glosario

| Término | Significado |
|---|---|
| Producto | Artículo conceptual de una marca: "Leche Lala Entera" |
| Variante | Presentación concreta: "1 L", "6 × 1 L", "A granel (kg)" |
| Unidad base | g, ml o pieza; el precio por unidad base permite comparar variantes |
| Listing | Una URL de una tienda en línea vinculada a una variante |
| Observación | Precio visto sin comprar: anaquel (`shelf`) o web (`web`) |
| Precio efectivo | Lo pagado por unidad después de promociones (2x1 → la mitad) |
| Alias de ticket | Texto de una línea de ticket de una tienda que ya se vinculó a una variante |
| Agente | El servicio Python en el servidor casero |
| T0–T3 | Niveles de procesamiento de imagen: catálogo, dispositivo, casa, IA |
