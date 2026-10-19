# Spike D · CPU del Worker en el plan Free (T-013)

**Fecha:** 2026-10-19 · **Decide:** D3 (plan de Workers) · **Resultado:** se queda en **Free** (decisión de Mauricio), con páginas de pull de 100 filas y vigilancia de errores 1102.

## Entorno y método

- Worker `maunedas-dev` en la cuenta propia de Maunedas, plan **Workers Free** (límite nominal de 10 ms de CPU por invocación), D1 `maunedas-dev` en WNAM.
- Código real de T-021 (verificación del token), T-022 (firma del token de Google), T-031 (push) y T-032 (pull), llamado desde rutas temporales `/v1/__spike/d/*` protegidas por `SPIKE_TOKEN` y `SPIKES=1`. El código y el script de carga viven en la rama `spike/d-worker-cpu`; **no** se fusionaron a `main`.
- CPU medida con `wrangler tail --format json` (`cpuTime` y `wallTime` por invocación); dentro del Worker no se puede medir CPU (`performance.now()` solo avanza con E/S).
- Una sola pasada desde el servidor casero, 1 s entre peticiones. Datos realistas: 500 productos y 500 variantes, compras de 1 encabezado + 99 líneas. Las claves de prueba se generaron en el script y nunca se guardaron. Al terminar se borraron el secreto, los datos del spike y se volvió a desplegar `main`.

## Resultados

### Pasada 1

| Escenario | n | CPU p50 (ms) | CPU p95 (ms) | CPU máx (ms) | Pared p50 (ms) | Resultados |
|---|---:|---:|---:|---:|---:|---|
| `/batch?n=102` | 3 | 2 | 2 | 2 | 36 | ok |
| `/batch?n=150` | 3 | 2 | 3 | 3 | 59 | ok |
| `/batch?n=50` | 3 | 2 | 4 | 4 | 34 | ok |
| `/google-sign` | 40 | 2 | 4 | 5 | 3 | ok |
| `/jwt` | 40 | 1 | 2 | 7 | 2 | ok |
| `/match` | 20 | 27 | 65 | 97 | 53 | ok |
| `/noop` | 30 | 0 | 1 | 9 | 1 | ok |
| `/pull` | 20 | 17 | 23 | 25 | 68 | ok |
| `/push` | 30 | 12 | 21 | 52 | 142 | ok |
| `/queries?n=40` | 3 | 33 | 35 | 35 | 799 | ok |
| `/queries?n=60` | 3 | 47 | 51 | 51 | 1275 | ok |

- `/push`: 10 pushes de 100 productos o variantes y 20 de 1 compra + 99 líneas.
- `/pull`: pull desde cero de todas las tablas con `limit` 500 (hasta ~1,500 filas por respuesta).
- `/match`: aproximación de 09 §5.3 (T-040 aún no existe): 40 líneas normalizadas contra 500 variantes cargadas de D1, todo en memoria.
- `/jwt` importa la llave en cada petición (cota superior; en producción `createRemoteJWKSet` la cachea).

### Pasada 2 (lotes más chicos)

| Escenario | n | CPU p50 (ms) | CPU p95 (ms) | CPU máx (ms) | Pared p50 (ms) | Resultados |
|---|---:|---:|---:|---:|---:|---|
| `/pull` | 1 | 20 | 20 | 20 | 90 | ok |
| `/pull?limit=100` | 15 | 6 | 13 | 13 | 43 | ok |
| `/pull?limit=200` | 15 | 10 | 13 | 13 | 55 | ok |
| `/push?size=50` | 15 | 11 | 26 | 26 | 126 | ok |

## Lectura

- **Caben de sobra:** verificar el token (p95 2 ms) y firmar el token de Google en frío (p95 4 ms).
- **Pasan del límite nominal:** push (p95 21–26 ms, con 50 o 100 filas: el costo fijo de las consultas a D1 domina, ~0.8 ms de CPU por consulta), pull completo con 500 filas por tabla (p95 23 ms; **13 ms con páginas de 100 o 200**) y la vinculación ingenua de tickets (p95 65 ms).
- **Cloudflare no cortó ninguna petición** (0 resultados `exceededCpu`, todas `ok`), aunque varias pasaron de 10 ms.
- **El límite de 50 consultas por invocación no se aplicó:** un batch de 150 sentencias (CPU 2–3 ms) y 60 consultas separadas en una invocación respondieron bien.
- El criterio de 11 §7 (p95 < 8 ms en todas) pedía Paid.

## Decisión (D3 → T40)

Mauricio decidió **quedarse en Free**:

- `POST /v1/sync/pull` usa **100 filas por tabla por omisión** (máximo 500).
- Se vigilan los errores **1102** / `exceededCpu` en Workers Logs; si aparecen en uso real, se pasa a Workers Paid (5 USD/mes).
- T-040 debe preseleccionar candidatos por SQL (09 §4.1, máximo 50) en lugar de puntuar contra todo el catálogo, y medir su CPU.
