# PLAN — Ahorrando Maunedas

Vista por etapas. El desglose implementable con dependencias y criterios de aceptación está en [`docs/sdd/12-tareas.md`](docs/sdd/12-tareas.md); aquí solo se marca el avance por bloque.

Convención: `[ ]` pendiente · `[~]` en curso · `[x]` hecho.

---

## Etapa 0 — Fundaciones y pruebas de riesgo

Objetivo: esqueleto desplegable y decisiones abiertas resueltas con datos antes de escribir funcionalidad.

- [ ] Monorepo, CI, recursos de Cloudflare, Firebase y OpenRouter — T-001 a T-005
- [ ] `packages/shared` pasando todos los fixtures; tokens de diseño — T-006, T-007
- [ ] Spikes A (rembg), B (scraping), C (tickets), D (CPU), E (correo sintético) — T-010 a T-014
- [ ] Decisiones D2, D3, D5, D9 cerradas — T-015

**Hecho cuando:** spikes documentados en `ESTADO.md`, decisiones cerradas y un deploy de dev responde con auth real.

---

## Etapa 1 — Núcleo (MVP)

Objetivo: los cuatro usuarios registran compras reales, offline en Android, con historial y comparación por unidad; iPhone por web.

- [ ] Worker: base, auth (usuario/contraseña + Google), usuarios, bootstrap, proxy de auth, esquema y semillas — T-020 a T-027
- [ ] Sync push/pull — T-030 a T-032
- [ ] Consulta, historial, comparador, compras, códigos, imágenes, fusión — T-033 a T-038
- [ ] IA: gateway, presupuesto y extracción de tickets — T-039, T-040
- [ ] Android base (módulos, pricing, Room, red, sync, subidas, diseño) — T-100 a T-106
- [ ] Android funcional: login, inicio, catálogo, fichas, escáner, fotos, compras, tickets, anaquel, ajustes — T-110 a T-126
- [ ] Web: base, catálogo, compras, tickets, anaquel, admin, cuenta — T-160 a T-166
- [ ] Cierre con checklist y dos semanas de uso — T-190

Datos semilla (T-026):
- **Tiendas:** Costco, Sam's Club, Soriana, Bodega Aurrera, Gran Bodega, Walmart, Farmacias Guadalajara, Farmacias Similares, Chedraui, La Comer, OXXO, Amazon, Mercado Libre. Con `adapter` en Amazon (`amazon_mx`), Costco (`costco_mx`), Walmart (`walmart_mx`) y Sam's (`sams_mx`).
- **Categorías:** Despensa (Granos y pastas, Enlatados, Aceites y condimentos, Botanas), Refrigerados (Lácteos, Carnes, Embutidos), Frutas y verduras, Bebidas, Limpieza, Higiene personal, Farmacia, Mascotas.

**Hecho cuando:** checklist de `docs/sdd/11-pruebas.md` §5 completo y dos semanas de uso real.

---

## Etapa 2 — Tracker y alertas

Objetivo: monitorear precios web desde casa (CP 72750) y avisar por push.

- [ ] Agente: proyecto, `/work`, scheduler, descarga y extracción, navegador — T-200 a T-204
- [ ] Adapters Amazon, Walmart, Sam's y Costco — T-205 a T-208
- [ ] Worker: resolver URL, ingesta, alertas, FCM, watchdog — T-210 a T-214
- [ ] Android y web: listings, reglas, historial de alertas, serie web, estado del agente — T-220 a T-223
- [ ] Respaldos y restauración probada — T-230, T-231
- [ ] Cierre — T-290

**Hecho cuando:** checklist de `docs/sdd/11-pruebas.md` §6 completo; 30 listings durante dos semanas con ≥ 95 % de revisiones exitosas en tiendas no bloqueadas.

---

## Etapa 3 — Ampliaciones

- [ ] Fotos: mejora en casa, editor, edición con IA — T-300 a T-302
- [ ] OCR local experimental — T-303
- [ ] Correos (compartir a la app; Gmail desde el agente) — T-304
- [ ] Mercado Libre y más tiendas — T-305
- [ ] Importación CSV/Excel y CFDI/XML — T-306, T-307
- [ ] API para Home Assistant — T-308
- [ ] Métricas del agente en InfluxDB/Grafana — T-309
- [ ] PWA offline — T-310
