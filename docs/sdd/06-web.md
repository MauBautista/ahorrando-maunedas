# 06 · Web

Requisitos: los mismos que Android salvo offline (RNF-01 no aplica en E1); RF-ADM-01 a 03 solo existen en web. Es también la app para iPhone.

## 1. Stack

| Tema | Decisión |
|---|---|
| Base | React + TypeScript (`strict`) + Vite |
| Rutas | React Router (modo *data*: `loader` para datos iniciales, `lazy` por ruta) |
| Datos | TanStack Query sobre el cliente HTTP de §4 |
| Formularios | react-hook-form + Zod (esquemas de `packages/shared`) |
| Estilos | Tailwind CSS con variables CSS generadas desde `packages/design-tokens` |
| Gráficas | Recharts (puntos para compra/anaquel, línea `stepAfter` para web) |
| Escaneo | `@zxing/browser` con la cámara trasera (funciona en Safari de iPhone) |
| Auth | Firebase Auth JS (`02-autenticacion.md` §7) |
| Fechas y moneda | `Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City' })`, `Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' })` |

## 2. Estructura

```
apps/web/
├── index.html
├── vite.config.ts
├── public/manifest.webmanifest       # "Agregar a inicio" en iPhone (sin service worker en E1)
└── src/
    ├── main.tsx
    ├── router.tsx
    ├── lib/
    │   ├── firebase.ts               # 02 §7
    │   ├── api.ts                    # cliente HTTP con token y errores tipados
    │   ├── sync.ts                   # newRow, touch, push (04 §7)
    │   ├── images.ts                 # reducir, subir, URLs
    │   ├── format.ts                 # moneda, fechas, unidades
    │   └── queryClient.ts
    ├── components/                   # UI base: Button, MoneyInput, QuantityInput, StorePicker, VariantSearch, PriceChart…
    ├── features/
    │   ├── auth/  home/  purchases/  receipts/  catalog/  shelf/  admin/  account/
    │   └── tracking/                 # E2
    └── styles/tokens.css             # generado
```

## 3. Rutas y pantallas

| Ruta | Pantalla | Equivale en Android | Rol |
|---|---|---|---|
| `/login` | W-01 Login | S-01 | — |
| `/` | W-02 Inicio | S-02 | todos |
| `/compras` | W-03 Compras | S-03 | todos |
| `/compras/nueva` · `/compras/:id/editar` | W-05 Editor de compra | S-04, S-05 | todos |
| `/compras/:id` | W-04 Detalle de compra (líneas, promociones, fotos del ticket) | — | todos |
| `/compras/:id/ticket` | W-06 Revisión de ticket | S-06 | todos |
| `/catalogo` | W-07 Catálogo | S-07 | todos |
| `/productos/nuevo` · `/productos/:id/editar` | W-09 Editor de producto y variantes | S-09, S-10 | todos |
| `/productos/:id` | W-08 Ficha de producto | S-08 | todos |
| `/anaquel/nuevo` | W-10 Precio de anaquel | S-13 | todos |
| `/cuenta` | W-14 Cuenta (nombre, cambiar contraseña, cerrar sesión) | S-15 | todos |
| `/admin/usuarios` | W-11 Usuarios | — | admin |
| `/admin/fusionar` | W-12 Fusionar duplicados | — | admin |
| `/admin/ia` | W-13 Gasto de IA | — | admin |
| `/seguimiento` · `/alertas` | W-20, W-21 (E2) | S-20 a S-23 | todos |
| `/admin/agente` | W-22 Estado del agente (E2) | — | admin |

Las pantallas replican el contenido y las reglas de Android (`05-android.md` §5). Diferencias:

- **W-05 Editor de compra**: tabla editable en escritorio (una fila por línea, tabulación entre celdas); en móvil, tarjetas con el mismo editor en *sheet*. Escanear abre `@zxing/browser` en un modal.
- **Fotos de ticket**: `<input type="file" accept="image/*" capture="environment" multiple>` (máx. 4) → se reducen en el navegador (§5) → se crean las filas `images` por push → se suben los binarios → `POST /v1/receipts/extract`.
- **W-11 Usuarios**: tabla (usuario, nombre, rol, Google, activo) con acciones "Nuevo", "Editar", "Restablecer contraseña", "Desactivar/Activar". Alta: usuario, nombre, rol, contraseña inicial (con generador) y correo de Google opcional.
- **W-12 Fusionar**: elegir tipo (producto o variante), origen y destino con buscador; vista previa de cuántas filas se moverán; confirmar.
- **W-13 Gasto de IA**: barra del mes contra el tope, desglose por propósito, número de llamadas.

## 4. Cliente HTTP

```ts
// apps/web/src/lib/api.ts
import { auth } from './firebase';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}

async function request<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
  const token = await auth.currentUser?.getIdToken();
  const res = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Client-Schema': String(CLIENT_SCHEMA),
      'X-Client-Version': __APP_VERSION__,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 401 && retry && auth.currentUser) {
    await auth.currentUser.getIdToken(true);
    return request<T>(method, path, body, false);
  }
  if (res.status === 204) return undefined as T;

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = json.error ?? {};
    if (e.code === 'USER_NOT_ALLOWED' || e.code === 'USER_DISABLED') await auth.signOut();
    throw new ApiError(res.status, e.code ?? 'INTERNAL', e.message ?? 'Error inesperado', e.details);
  }
  return json as T;
}

export const api = {
  get: <T>(p: string) => request<T>('GET', p),
  post: <T>(p: string, b?: unknown) => request<T>('POST', p, b),
  patch: <T>(p: string, b?: unknown) => request<T>('PATCH', p, b),
  del: <T>(p: string) => request<T>('DELETE', p),
};
```

Mismo origen que el Worker: no hay CORS en producción. En desarrollo, `vite.config.ts` hace proxy de `/v1` y `/__` al Worker local (`wrangler dev`, puerto 8787).

## 5. Imágenes en el navegador

```ts
// apps/web/src/lib/images.ts
export async function downscaleToJpeg(file: File, maxSide = 1600, quality = 0.8): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.convertToBlob({ type: 'image/jpeg', quality });
}
```

- Tickets: 1600 px; fotos de producto: 2048 px, calidad 0.85.
- Subida: `PUT /v1/images/:id/blobs/original.jpg` con el `Blob` como cuerpo.
- Se muestran con las URLs firmadas que devuelven los endpoints de consulta (`ImageRef`), así funcionan en `<img>` sin cabeceras.
- `OffscreenCanvas` existe en Safari reciente; si no, se usa un `<canvas>` normal.

## 6. Build y despliegue

- `vite build` genera `apps/web/dist`. El Worker lo sirve con Workers Static Assets (`03-api.md` §2, `assets`):
  - `not_found_handling: "single-page-application"`: cualquier ruta sin archivo devuelve `index.html` (React Router resuelve).
  - `run_worker_first: ["/v1/*", "/agent/*", "/__/auth/*", "/__/firebase/*"]`: esas rutas siempre pasan por el Worker.
- Variables de Vite (versionadas, sin secretos): `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`, `VITE_SYNTHETIC_EMAIL_DOMAIN`. Archivos: `.env.development` (`vite dev`, proyecto de dev), `.env.dev` (`vite build --mode dev` para `maunedas-dev`; conserva `import.meta.env.PROD`, así que `authDomain` es el propio host) y `.env.production`.
- `pnpm --filter api deploy` = `pnpm --filter web build && wrangler deploy`; `deploy:dev` = `pnpm --filter web build --mode dev && wrangler deploy --env dev`.

## 7. iPhone

- `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">` y márgenes con `env(safe-area-inset-*)`.
- Inputs con `font-size: 16px` mínimo (evita el zoom automático de Safari).
- `manifest.webmanifest` + `apple-touch-icon` para "Agregar a pantalla de inicio".
- Login con Google por `signInWithPopup` y el proxy `/__/auth` (decisión T19); probar en Safari (checklist `11-pruebas.md`).

## 8. Pruebas

- Vitest + Testing Library: editor de compra (totales, promociones, validación), revisión de ticket (estados de línea), formularios de admin.
- Los cálculos vienen de `packages/shared` (ya probados con fixtures).
- Humo con Playwright contra `wrangler dev` (login con usuario de prueba, crear compra, ver historial) en CI opcional.
