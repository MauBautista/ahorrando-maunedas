# GOALS — Ahorrando Maunedas

## Visión

Saber cuánto cuesta realmente lo que se compra en casa, en qué presentación y en qué tienda conviene, y enterarse cuando algo baja de precio. Sin depender de que el servidor casero esté encendido y sin gastar en infraestructura más de lo que el sistema ayuda a ahorrar.

## Usuarios

Cuatro personas del hogar: un administrador y tres miembros con permisos equivalentes. Compras, catálogo y precios son compartidos; las alertas son personales.

## Objetivos

| # | Objetivo | Etapa |
|---|---|---|
| G1 | Historial completo de compras del hogar: tickets completos, con promociones y descuentos | 1 |
| G2 | Catálogo producto → variantes (presentaciones) → códigos de barras, con categorías jerárquicas y etiquetas | 1 |
| G3 | Precio normalizado por unidad (kg, L, 100 g, 100 ml, pieza) para comparar presentaciones y tiendas | 1 |
| G4 | Captura rápida en Android: escaneo de código, foto de ticket, precio de anaquel, todo **offline** | 1 |
| G5 | Web responsive para consulta y captura (y como app en iPhone) | 1 |
| G6 | Tracker de precios web (Amazon, Costco, Walmart, Sam's) con alertas push configurables por variante o listing | 2 |
| G7 | Fotos de producto limpias: catálogo abierto primero; foto propia con fondo removido y editable después | 1 (catálogo) · 3 (edición) |
| G8 | Respaldo independiente en casa de todos los datos y fotos | 2 |

## Criterios de éxito

- Registrar un ticket de ~40 artículos toma **≤ 5 min** con extracción asistida (≤ 15 min a mano).
- Tras dos meses de uso, **≥ 80 %** de las líneas de tickets de tiendas frecuentes se vinculan solas (alias aprendidos).
- Una alerta llega al teléfono **≤ 5 min** después de que el agente registra el cambio de precio.
- Con el servidor casero apagado, app y web siguen registrando y consultando; solo se pausan tracking, mejora de fotos y respaldos.
- En Android se puede registrar una compra completa en modo avión y se sincroniza sin pérdida al volver la señal.
- Gasto de IA **≤ 6 USD/mes** con tope duro. Cloudflare en plan gratuito, o 5 USD/mes solo si se justifica con datos.
- Respaldo diario con **una restauración de prueba exitosa** documentada.

## No-objetivos (por ahora)

- Inventario o despensa (qué hay en casa, cuándo se acaba).
- Registrar quién compró o con qué método de pago.
- App iOS nativa.
- Integración con Home Assistant (queda como API futura, sin acoplamiento).
- CFDI/XML, importación de correos y CSV en el MVP (la arquitectura los contempla).
- Web offline (PWA) en el MVP.
- Multi-hogar o producto público. Se diseña desacoplado, pero sin complicar el MVP pensando en miles de usuarios.

## Restricciones

- **Servidor casero modesto** (HP Pavilion, AMD A8-7410): trabajos pesados en serie, asíncronos y con límites de memoria.
- **El servidor casero nunca se expone a internet**: solo conexiones salientes hacia Cloudflare. Administración por Tailscale.
- **IA con presupuesto de 6 USD/mes**, procesamiento local y gratuito primero. Proveedor intercambiable por configuración.
- **Offline obligatorio en Android** (Room + WorkManager).
- **Scraping de uso personal y respetuoso**: baja frecuencia, sin evadir bloqueos.
