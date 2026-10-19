# Spike B · Scraping de tiendas prioritarias (T-011)

**Fecha:** 2026-10-19 · **Decide:** método por tienda, `needs_browser`, `min_spacing_s` y `mem_limit` del agente (SDD 07 §8–9, 11 §7).

## Entorno y protocolo

- Servidor casero (AMD A8-7410, 6.7 GB de RAM compartida con Home Assistant, sin AVX2), IP residencial en la zona Puebla–Cholula.
- Contenedor efímero `mcr.microsoft.com/playwright/python:v1.63.0-noble` con `--memory=1500m --cpus=1.5 --shm-size=512m`; no se tocó el compose del servidor.
- httpx 0.28.1 con los headers de 07 §8.1 (`Accept-Language: es-MX`), selectolax 1.0.1 (parser **lexbor**), Playwright 1.63.0 con Chromium headless, sin imágenes, fuentes ni medios.
- **Una sola pasada:** 12 peticiones HTTP y 2 cargas en navegador (solo para las URLs donde HTTP no dio precio y no hubo bloqueo). Separación mínima por tienda: 45 s en Amazon y 30 s en las demás, más 1–6 s de jitter. Sin login, sin cookies previas, sin reintentos.
- Scripts: `agent/spikes/scrape_probe.py` (sondeo), `agent/spikes/run_in_container.sh` (ejecución en el contenedor) y `agent/spikes/sanitize_fixture.py` (fixtures públicos sin scripts ni datos de sesión). La salida cruda (`agent/spikes/out/`) no se versiona.

## Resultados por URL

| Tienda | Caso | URL | Método que funcionó | Precio | Precio de lista | Stock | CP / sucursal | ms | RSS Chromium |
|---|---|---|---|---|---|---|---|---:|---:|
| Amazon | Pétalo Maxi Resist 18 rollos | `amazon.com.mx/dp/B0D364NN9H` | HTTP + selectores | $118.69 | — (sin tachado) | Disponible · vende Amazon México | Ubicación por IP: "Entrega en Cholula 72760" | 1,971 | — |
| Amazon | Ariel con toque de Downy 3 L | `amazon.com.mx/dp/B078SY7JHR` | HTTP (navegador no aporta) | — | — | "No disponible por el momento" | Igual | 1,763 (navegador 23,493) | 626 MB |
| Amazon | Ariel con toque de Downy 1.2 L | `amazon.com.mx/dp/B0812GFWJ6` | HTTP (navegador no aporta) | — | — | "No disponible por el momento" | Igual | 1,335 (navegador 8,615) | 759 MB |
| Walmart | Leche Lala UHT entera 1.5 L | `walmart.com.mx/ip/…/00750102055073` | **Bloqueado** | — | — | — | — | 455 | — |
| Walmart | Pétalo 12 rollos | `walmart.com.mx/ip/…/00750642561780` | **Bloqueado** | — | — | — | — | 460 | — |
| Walmart | Pétalo 4 rollos (súper) | `super.walmart.com.mx/ip/…/00750642564900` | **Bloqueado** | — | — | — | — | 715 | — |
| Sam's | Leche entera Lala 12 × 1 L | `sams.com.mx/ip/…/980034851` | HTTP + JSON-LD y `__NEXT_DATA__` | $322.24 | — | `IN_STOCK` | Club por defecto: CP 11220 (Miguel Hidalgo, CDMX), club `0000009996` | 1,146 | — |
| Sam's | Pétalo Ultra Resistente 10 × 4 | `sams.com.mx/ip/productos/980020572` | HTTP + JSON-LD y `__NEXT_DATA__` | $296.67 | — | `IN_STOCK` | Igual | 1,568 | — |
| Sam's | Pétalo Kimberly-Clark 6 × 250 m | `sams.com.mx/ip/…/000188399` | HTTP + JSON-LD y `__NEXT_DATA__` | — | — | `OUT_OF_STOCK` (sin precio) | Igual | 1,068 | — |
| Costco | Kirkland papel higiénico 30 pzas | `costco.com.mx/…/p/6262016` | HTTP + JSON-LD | $529.00 | — | `InStock` | El sitio pide CP para entrega; sin elegirlo, el precio de JSON-LD no cambia | 192 | — |
| Costco | Kirkland cápsulas 152 pzas | `costco.com.mx/…/p/1785666` | HTTP + JSON-LD | $549.00 | — | `InStock` | Igual | 252 | — |
| Costco | Santa Clara leche entera 6 × 1 L | `costco.com.mx/…/p/668241` | HTTP + JSON-LD | $189.00 | — | `InStock` | Igual | 409 | — |

En ninguna URL se observó precio tachado: faltan fixtures "con precio de lista" (se capturarán en T-205 a T-208 cuando aparezcan).

## Observaciones

- **Walmart México bloquea desde la primera petición HTTP**: redirige a `/blocked?url=…` con "Verifica tu identidad" y un reto de PerimeterX/HUMAN (`px-captcha`, "Mantén presionado el botón para confirmar que no eres un robot"). Pasa igual en `www.walmart.com.mx` y en `super.walmart.com.mx`. Por la regla 10 no se intentó con navegador ni de ninguna otra forma.
- **Sam's**, del mismo grupo y con la misma plataforma Next.js, **no bloqueó**. El producto de la página está en `props.pageProps.initialData.data.product` (`priceInfo.currentPrice.price`, `priceInfo.wasPrice`, `availabilityStatus`, `location`). Ojo: un recorrido genérico de `__NEXT_DATA__` encuentra primero los precios de los carruseles, no del producto.
- **Sam's usa un club por defecto en CDMX** (CP 11220) para visitantes sin sesión; para ver el precio de un club de Puebla habría que elegir club (la ubicación vive en la sesión). Falta confirmar en T-207 si el precio cambia entre clubes.
- **Amazon no publica JSON-LD de producto.** El precio a pagar está en `#corePriceDisplay_desktop_feature_div .apex-pricetopay-value .a-offscreen`. El primer `.a-text-price` del bloque es el **precio por unidad** (`.apex-priceperunit-value`, p. ej. "$6.59 por unidad"), no el de lista. `#availability` contiene un `<script>` que hay que quitar antes de leer el texto. Amazon ubica al visitante por IP ("Entrega en Cholula 72760"), así que no hace falta fijar CP.
- **Costco publica JSON-LD con `"@type": "product"` en minúsculas** (hay que comparar sin distinguir mayúsculas), con `priceValidUntil`. En el DOM, el precio del producto está dentro de `sip-product-details`, pero en la página de la leche no aparece en el HTML del servidor: el primer `.product-price-amount` de la página ($259) es de un carrusel, igual que los botones "Agotado". El `storefront-state` solo trae configuración del sitio.
- **El navegador no aportó nada** en Amazon (los dos casos eran productos sin oferta) y costó 8.6–23.5 s y 626–759 MB por página.
- **selectolax 1.0 retiró el parser Modest** (`selectolax.parser.HTMLParser` lanza `ImportError`); hay que usar `selectolax.lexbor.LexborHTMLParser`.

## Recomendación por adapter

| Adapter | Método | `needs_browser` | `min_spacing_s` | Notas para T-205 a T-208 |
|---|---|---|---|---|
| `amazon_mx` | HTTP + selectores del bloque `apex` | No | 45 | `in_stock=false` y sin precio con "No disponible por el momento"; vendedor en `#merchantInfoFeature_feature_div`; precio de lista en `.basisPrice` (por confirmar con un fixture) |
| `walmart_mx` | — | — | 30 | **Bloqueado por PerimeterX.** Con la regla 10 el adapter solo puede detectar el bloqueo (`/blocked`, `px-captcha`) y marcar `blocked`. Decisión para Mauricio: quitar Walmart del tracking de la Etapa 2 o intentar una sola vez con Playwright (lo más probable es que también lo bloquee) |
| `sams_mx` | HTTP + JSON-LD; `__NEXT_DATA__` (producto principal) para precio de lista y stock | No | 30 | Precio del club por defecto (CDMX); revisar si cambia por club |
| `costco_mx` | HTTP + JSON-LD (tipo sin distinguir mayúsculas) | No | 30 | DOM solo como respaldo dentro de `sip-product-details`; ignorar carruseles |

`domains` de `walmart_mx` debe incluir `super.walmart.com.mx`.

## Memoria del contenedor

Ninguna tienda necesita navegador. El pico medido de Chromium fue de 759 MB y nunca se llegó al límite de 1,500 MB. **Recomendación:** `mem_limit: 1200m` con Playwright habilitado solo como último recurso (pico medido más margen para Python), en lugar de los 1,500 MB provisionales. El spike A (rembg) define la memoria de la Etapa 3.

## Fixtures

En `agent/tests/fixtures/html/<adapter>/`, recortados con `sanitize_fixture.py` (124 KB en total): solo JSON-LD, el subárbol del producto en `__NEXT_DATA__` (Sam's) y las secciones DOM del producto principal, sin scripts, estilos, SVG ni campos ocultos.

| Adapter | Casos |
|---|---|
| `amazon_mx` | `ok`, `sin_stock` |
| `walmart_mx` | `bloqueo` |
| `sams_mx` | `ok`, `sin_stock` |
| `costco_mx` | `ok`, `ok_con_carrusel` (precio solo en JSON-LD) |
