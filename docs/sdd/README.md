# SDD — Ahorrando Maunedas

**Documento de Diseño de Software · v1 · 2026-09-30**

Este SDD es la especificación para implementar. Cada requisito, contrato y tarea tiene un ID estable para que Claude Code (o cualquiera) pueda trabajar una tarea a la vez y verificarla contra sus criterios de aceptación.

## Cómo usarlo

1. Elige la siguiente tarea `T-xxx` sin dependencias pendientes en [`12-tareas.md`](./12-tareas.md).
2. Lee solo las secciones que la tarea referencia (cada tarea lista sus documentos).
3. Implementa, cumple los criterios de aceptación y los tests indicados.
4. Marca la tarea en `12-tareas.md` y actualiza `ESTADO.md`.

Si el código y el SDD no coinciden, se corrige uno de los dos **en el mismo cambio**. Nunca se deja divergencia.

## Índice

| # | Documento | Contenido |
|---|---|---|
| 01 | [Requisitos](./01-requisitos.md) | Requisitos funcionales (`RF-*`) y no funcionales (`RNF-*`) con criterios de aceptación |
| 02 | [Autenticación](./02-autenticacion.md) | Usuario/contraseña y Google con Firebase, alta de usuarios, verificación en el Worker, proxy web |
| 03 | [API](./03-api.md) | Convenciones, errores, contratos de todos los endpoints `/v1` |
| 04 | [Sincronización](./04-sincronizacion.md) | Registro de tablas, push, pull, conflictos, implementación en Room |
| 05 | [Android](./05-android.md) | Módulos, arquitectura, pantallas, flujos de captura |
| 06 | [Web](./06-web.md) | Estructura, rutas, pantallas, despliegue con el Worker |
| 07 | [Agente casero](./07-agente.md) | Paquete Python, scheduler, adapters, contratos `/agent/v1`, Docker |
| 08 | [Alertas y notificaciones](./08-alertas.md) | Evaluación, mensajes, FCM |
| 09 | [IA y tickets](./09-ia-y-tickets.md) | Gateway, presupuesto, extracción, vinculación, promociones |
| 10 | [Imágenes](./10-imagenes.md) | Catálogo abierto, subida, renditions, recorte en dispositivo, editor |
| 11 | [Pruebas](./11-pruebas.md) | Estrategia, fixtures, casos por módulo, checklist manual |
| 12 | [Tareas](./12-tareas.md) | Desglose `T-xxx` con dependencias y criterios de aceptación |

Documentos relacionados: [`../ARQUITECTURA.md`](../ARQUITECTURA.md) (vista general), [`../esquema-d1.sql`](../esquema-d1.sql) (modelo de datos), `../../fixtures/` (vectores de prueba).

## Convenciones de IDs

| Prefijo | Qué | Ejemplo |
|---|---|---|
| `RF-<área>-nn` | Requisito funcional | `RF-COM-03` promociones por línea |
| `RNF-nn` | Requisito no funcional | `RNF-01` offline en Android |
| `E-<CÓDIGO>` | Código de error de la API | `E-BARCODE_TAKEN` |
| `T-nnn` | Tarea implementable | `T-120` editor de compra |
| `D-n` / `T-n` en ESTADO | Decisión abierta / tomada | ver `ESTADO.md` |

Áreas: `AUTH` autenticación, `CAT` catálogo, `COM` compras, `TIC` tickets, `PRE` precios, `SYN` sincronización, `IMG` imágenes, `TRK` tracking, `ALR` alertas, `ADM` administración, `BAK` respaldos.

## Parámetros del sistema

| Nombre | Valor | Dónde se usa |
|---|---|---|
| Base URL | `https://maunedas.<subdominio>.workers.dev` | Android (`BuildConfig.API_BASE_URL`), web (mismo origen) |
| Zona horaria | `America/Mexico_City` (UTC−6, sin horario de verano) | Presentación, cortes de mes del presupuesto de IA |
| Moneda | MXN | Todo |
| Código postal de referencia | `72750` | Adapters de tracking |
| Presupuesto IA | 6 USD/mes, aviso al 80 % | Gateway de IA |
| Intervalo de tracking por defecto | 480 min | `stores.default_check_interval_min` |
| Límite de push | 100 mutaciones / request | Sync |
| Límite de pull | 500 filas por tabla / request | Sync |
| Lote de resultados del agente | 20 / request | `/agent/v1/observations` |
| `SYNTHETIC_EMAIL_DOMAIN` | `maunedas.local` (spike E) | Auth usuario/contraseña |
| `applicationId` | `com.maubautista.maunedas` | Android |
| `minSdk` | 26 | Android |
