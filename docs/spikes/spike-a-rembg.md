# Spike A · rembg en el servidor (T-010) — factibilidad

**Fecha:** 2026-11-04 · **Decide (en parte):** si la mejora en casa (T2) es viable en el servidor. D5 (qué modelo) queda pendiente de la calidad con fotos reales de Mauricio (11 §7).

## Entorno y protocolo

- **Servidor casero:** AMD A8-7410, con AVX y SSE4.2 pero sin AVX2 ni FMA, y 6.7 GB de RAM compartida con Home Assistant.
- **Contenedor efímero:** `ghcr.io/astral-sh/uv:python3.12-bookworm-slim` con `--memory=2g --cpus=2`. No se tocó ningún compose.
- **Software:** rembg 2.0.86 y onnxruntime 1.31.0 (`CPUExecutionProvider`), sin *alpha matting*.
- **Fotos:** 5 públicas de Open Food Facts (CC BY-SA, no se versionan).
  - Dos de un producto en la mano con fondo de tienda (microdacyn, Alpura).
  - Tres de producto casi sin fondo; dos son envases blancos o claros (Kirkland, Lala) y una es el pan Bimbo.
  - Se redujeron a ≤ 2048 px, como las guarda la app (10 §4.2). Hubo una segunda pasada a ≤ 1024 px, el tamaño de `processed` (10 §5).
- **Medición:** un proceso por modelo, para que `ru_maxrss` sea su pico.
- **Scripts:** `agent/spikes/rembg_photos.py` (descarga, una petición a la vez con pausa) y `agent/spikes/rembg_bench.py` (medición). La salida (`agent/spikes/out/spike-a/`) no se versiona.

## Resultados

| Modelo | Entrada | Carga | Por foto (promedio de 5) | Pico de memoria | ≤ 60 s y ≤ 1.2 GB (11 §7) |
|---|---|---:|---:|---:|---|
| `u2netp` | 2048 px | 1.8 s | 3.1 s | 1,052 MB | Sí |
| `silueta` | 2048 px | 5.6 s | 9.1 s | 851 MB | Sí |
| `u2net` | 2048 px | 18.7 s | 7.7 s | 1,180 MB | Sí, justo |
| `isnet-general-use` | 2048 px | 18.9 s | 20.1 s | 1,813 MB | **No** (memoria) |
| `u2netp` | 1024 px | 1.8 s | 3.2 s | 1,010 MB | Sí |
| `silueta` | 1024 px | 5.6 s | 9.1 s | 811 MB | Sí |
| `u2net` | 1024 px | 18.8 s | 7.7 s | 1,167 MB | Sí, justo |

`onnxruntime` arrancó sin "instrucción ilegal": no necesita AVX2.

## Calidad (preliminar)

Sobre estas 5 fotos públicas, vistas sobre gris. La calificación 1–5 de 11 §7 la hace Mauricio con sus 10 fotos.
- **En la mano, con fondo de tienda:** los cuatro modelos quitan bien la mano, el piso y el anaquel. `u2net` e `isnet-general-use` dejan los bordes más limpios.
- **Producto blanco sobre fondo claro:** es el caso difícil.
  - `isnet-general-use` borra casi todo el envase Kirkland.
  - Los cuatro pierden la parte blanca de abajo del envase Lala.
- **Pan Bimbo:** `u2netp` conserva el cierre azul de arriba, que `silueta` y `u2net` desvanecen.

## Conclusiones

1. **T2 es viable:** `onnxruntime` corre en el A8-7410. No se descarta la mejora en casa.
2. **`isnet-general-use` queda fuera:** pasa de 1.8 GB. 07 §11 lo traía como ejemplo de `REMBG_MODEL`.
3. **Memoria:** el pico (0.8–1.2 GB) casi no depende del tamaño de la foto; viene del modelo y las librerías. Por eso el agente, con `mem_limit: 1200m` y Chromium como último recurso, no puede cargar el modelo en su proceso. T-300 lo corre en un contenedor aparte del mismo proyecto `maunedas`, con su propio límite (decisión T105).
4. **Candidatos para D5:**
   - `u2netp`: 3 s, 1.0 GB, el que mejor conservó los envases en esta muestra;
   - `u2net`: 7.7 s, 1.2 GB;
   - `silueta`: 9 s, 0.85 GB.
   
   Provisional para T-300: `u2netp`, configurable por `REMBG_MODEL`.
5. **Pendiente de Mauricio:** las 10 fotos reales del spike A y su calificación, para cerrar D5.
