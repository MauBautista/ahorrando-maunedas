# Ahorrando Maunedas

Sistema del hogar para registrar compras, comparar precios por unidad entre presentaciones y tiendas, y recibir alertas cuando algo baja de precio.

- App Android nativa offline-first (`apps/android`)
- Web React, también usada desde iPhone (`apps/web`)
- API en Cloudflare Workers + D1 + R2 (`apps/api`)
- Agente en el servidor casero para scraping, imágenes y respaldos (`agent/`)
- Reglas compartidas con vectores de prueba comunes (`packages/shared`, `fixtures/`)

## Documentación

- [`GOALS.md`](GOALS.md) — objetivos y restricciones
- [`PLAN.md`](PLAN.md) — etapas y avance
- [`ESTADO.md`](ESTADO.md) — estado actual y decisiones
- [`docs/sdd/`](docs/sdd/README.md) — especificación para implementar
- [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md) — vista general

## Desarrollo

Requisitos: Node 24 (`.nvmrc`), pnpm vía corepack, JDK 17, Android SDK, Python 3.12 con uv.

```bash
corepack enable pnpm
pnpm install
pnpm test
```

Los comandos completos están en [`CLAUDE.md`](CLAUDE.md#comandos).
