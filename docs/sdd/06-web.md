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
- `pnpm --filter api deploy:prod` = `pnpm --filter web build && wrangler deploy`; `deploy:dev` = `pnpm --filter web build --mode dev && wrangler deploy --env dev` (no se llama `deploy` a secas porque choca con `pnpm deploy`).

## 7. iPhone

- `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">` y márgenes con `env(safe-area-inset-*)`.
- Inputs con `font-size: 16px` mínimo (evita el zoom automático de Safari).
- `manifest.webmanifest` + `apple-touch-icon` para "Agregar a pantalla de inicio".
- Login con Google por `signInWithPopup` y el proxy `/__/auth` (decisión T19); probar en Safari (checklist `11-pruebas.md`).

## 7.1 Implementación del esqueleto (T-160, decisión T69)

- **Versiones:** React Router 8.4 en modo *data* (`createBrowserRouter`; `RouterProvider` sale de `react-router/dom`), TanStack Query 5, Tailwind 4 con los tokens como tema (`styles/app.css`: `bg-surface`, `text-title`, `text-on-surface-variant`…). Cada pantalla es su propio *chunk* (`lazy`).
- **Autenticación:** `lib/auth.ts` define `AuthPort` y `lib/firebase.ts` lo implementa con Firebase (02 §7). La app lo recibe por contexto, así que las pruebas pasan uno falso y nada sale a Google.
- **Sesión:**
  - `RequireSession` espera a Firebase y luego `GET /v1/me` (`MeResponse` en `packages/shared/src/api/me.ts`). Sin sesión manda a `/login` y recuerda la ruta; después del login regresa ahí.
  - Sin red o con un error 5xx muestra "Reintentar" sin cerrar la sesión.
  - `USER_NOT_ALLOWED` o `USER_DISABLED` cierran la sesión (el cliente HTTP) y el login muestra el mensaje; con Google, "Esta cuenta de Google no está registrada…" (02 §8).
- **Armazón:** encabezado con la navegación arriba en pantallas anchas; en el teléfono, barra inferior con Inicio, Compras, Catálogo y Cuenta, dentro de las zonas seguras del iPhone. "Administración" aparece solo para admins y `RequireAdmin` protege `/admin/*`.
- **Pantallas:**
  - Inicio saluda y tiene las acciones grandes.
  - Cuenta tiene "Cerrar sesión".
  - Las rutas de T-161 a T-166 dicen "Esta pantalla llega pronto".
- **Íconos:** el anillo sobre el verde de la marca lo dibuja `apps/web/scripts/icons.ts` (sin herramientas de imágenes). El manifiesto es `public/manifest.webmanifest`.
- **Versión del cliente:** `__APP_VERSION__` sale de `apps/web/package.json` y `X-Client-Schema` es `CLIENT_SCHEMA = 1` (`lib/api.ts`), como Android.

## 7.2 Catálogo y ficha (T-161, decisión T70)

- **W-07:**
  - **Filtros:** la búsqueda (con 250 ms de pausa), la categoría (el árbol, con sangría por nivel) y la etiqueta viven en la URL (`?q=&categoria=&etiqueta=`), así que sobreviven a "Atrás" y se pueden compartir.
  - **Páginas:** de 30 en 30 con "Ver más" (`next_cursor`).
  - **Tarjeta:** foto, nombre, marca, presentaciones y mejor precio con el punto de su fuente y "presentación en tienda · hace N días". Los mensajes para "sin productos" son los de Android.
- **W-08:**
  - Encabezado con foto grande, marca, ruta de categoría y etiquetas, y acciones "Editar", "Precio de anaquel" y, para admins, "Fusionar con otro producto". Esas pantallas llegan con W-09, T-164 y T-165.
  - Pestañas en la URL (`?vista=presentaciones|comparar|historial`).
  - **Comparar** es una tabla con desplazamiento horizontal, porque en la web cabe. Marca "Más barato" y deja aparte "Otras medidas (no se comparan)".
  - **Historial** usa los filtros de Android (T58), y Recharts con una serie de puntos por fuente, sin líneas. La gráfica lleva una descripción para lectores de pantalla y debajo va la lista de precios, del más nuevo al más viejo. Recharts se carga solo al abrir esa pestaña (440 KB).
- **Antigüedad** ("hoy", "ayer", "hace N días…"): días de calendario en la Ciudad de México, como `Dates.ago`, contados desde que llegaron los datos (`dataUpdatedAt`).
- **Fotos** en el orden de 10 §1, con URLs firmadas; sin foto o si falla, la inicial.
- **Tipos compartidos:** `LookupsResponse` y `ProductDetailResponse` en `packages/shared/src/api/catalog.ts`.

## 7.3 Editor de producto y presentaciones (T-161, decisión T71)

- **Rutas:** `/productos/nuevo` crea el producto con su primera presentación en un solo push. `/productos/:id/editar` edita el producto y abre cada presentación (o "Agregar presentación") en un diálogo, que guarda con su propio push.
- **Reglas de Android:** la de `ProductForm` y `VariantForm` (T-113, T56):
  - la unidad para comparar sigue a la medida hasta que se elige otra;
  - la etiqueta sigue a `suggestVariantLabel` y borrarla vuelve a la sugerida;
  - "a granel" solo por masa (1 kg, paquete de 1), y piezas enteras;
  - etiquetas con alta rápida que reutilizan una del mismo nombre;
  - los mismos mensajes.
- **Reglas compartidas en `packages/shared`:** la conversión de contenido (`catalog/content.ts`, como `Content` de Kotlin) y la lectura de cantidades y precios tecleados (`text/decimal.ts`, como `DecimalText`). Las pruebas repiten los casos de Android.
- **Códigos:**
  - Al agregar uno se revisa el formato y si ya es de otra presentación, con `GET /v1/search/variants` (coincidencia exacta, sin consultar catálogos abiertos).
  - Quitar uno es el tombstone de su fila. Para eso `GET /v1/products/:id` devuelve ahora `barcode_rows` (`id`, `code`, `updated_at`) junto a `barcodes`.
- **Push (04 §7):**
  - **Filas nuevas:** llevan todas sus columnas.
  - **Cambios:** solo lo que edita el formulario, con `updated_at` posterior a la fila leída (`touchedAt`), y el servidor conserva lo demás (04 §3.3).
  - **`product_tags`:** usa su UUIDv5, así que quitar y volver a poner una etiqueta es la misma fila.
  - **Borrar** (solo admin, RF-CAT-08): lleva las presentaciones y sus códigos (04 §6.2).
- **Conflictos:**
  - Se dicen en un mensaje: código ya usado, medida bloqueada por compras, `STALE` o solo admin.
  - Tras un `STALE` del producto, el formulario vuelve a lo que tiene el servidor.
  - Si un producto nuevo se guardó a medias, se abre su edición.

## 7.4 Compras (T-162, decisión T72)

- **W-03 Compras:**
  - Lista por día de la Ciudad de México ("Hoy", "Ayer", "martes 20 de octubre"), la más nueva primero.
  - Cada compra: tienda y sucursal, hora, productos, total (el del ticket, o Σ líneas − descuentos del ticket, nunca menos de cero, como S-02) y "Borrador".
  - Filtros en la URL: tienda, fechas ("Este mes", "Mes pasado", "Últimos 3 meses" o "Elegir fechas…", en días completos de la Ciudad de México, T59) y estado.
  - `GET /v1/purchases` trae `discount_cents` para calcular ese total.
- **W-04 Compra:**
  - Productos con cantidad × precio, promoción, total y lo pagado por unidad con el descuento del ticket prorrateado (como el historial).
  - Descuentos del ticket, totales con "No cuadra por $X" y las páginas del ticket.
  - "Editar" abre W-05.
- **W-02 Inicio:** gasto del mes (compras confirmadas de este mes, sumando páginas de 100), aviso de borradores y las 5 compras más recientes.
- **W-05 Editor**, con las reglas de Android (`PurchaseEditor`, `LineForm`):
  - **Encabezado:** tienda (con "Nueva tienda"), sucursal opcional (con "Nueva sucursal"; ciudad por omisión, la de una sucursal ya usada, o Puebla), fecha y hora de la Ciudad de México. La tienda y la sucursal nuevas se escriben al momento, como en Android.
  - **Línea** (S-05, en un diálogo):
    - búsqueda por palabras o código con "Último aquí";
    - cantidad con −/+ en piezas enteras, o kilos si se pesa;
    - precio, promoción con sus parámetros y "Ajustar el descuento a mano" (se guarda como `other`);
    - total y precio efectivo en vivo, y "Guardar y otro".
  - **Productos:** en el teléfono, tarjetas que abren su diálogo. Desde `md`, una tabla con cantidad y precio editables en su celda (Tab pasa de una a otra; se toma al salir de la celda, y si no vale se dice y vuelve).
  - **Más acciones en cada producto:** subir, bajar y quitar con "Deshacer". Una línea sin vincular (de ticket) dice "Vincular" y conserva cantidad y precio.
  - **Pie:** Σ, descuentos del ticket (diálogo con descripción y monto), total calculado, "Total del ticket" y "No cuadra por $X".
  - **Confirmar:**
    - Pide tienda, un producto y que ninguno esté sin precio (T64).
    - Si no cuadra por más de $1.00, pregunta antes.
    - Una línea de ticket vinculada enseña su alias a la tienda (09 §7.4; la web no lee los alias, así que lo escribe cada vez, con el mismo id UUIDv5).
  - **Eliminar compra:** cualquiera (RF-COM-08); se lleva sus líneas, promociones y páginas (04 §6.2).
  - **Autoguardado al salir:** si hay tienda y algo cambió, se guarda antes de cambiar de pantalla (`useBlocker`). Al cerrar la pestaña con cambios, el navegador pregunta.
- **Push (04 §7):**
  - Las filas nuevas llevan todas sus columnas.
  - Los cambios llevan solo lo que el editor maneja, con `updated_at` posterior a la fila leída.
  - Lo que se quitó es tombstone.
  - Si hay un conflicto, el editor vuelve a cargar lo que tiene el servidor y lo dice.
- **API:**
  - `GET /v1/search/variants` trae la medida, el contenido, a granel y la unidad de cada variante, y con `store_id` su último precio de lista ahí.
  - `GET /v1/purchases/:id` trae lo mismo de la variante de cada línea.
- **Llega después:** fotos de ticket y "Extraer" (T-163, W-06). Mientras, "Foto de ticket" de Inicio abre una compra nueva.

## 7.5 Precio de anaquel y escaneo (T-164, decisión T74)

- **Escáner (`ScanDialog`):**
  - Abre la cámara trasera en un modal con `@zxing/browser` 0.2.1 y `@zxing/library` 0.23.0. Se cargan solo al abrirlo, para no hacer más pesada la app.
  - Lee los formatos de Android (EAN-13, EAN-8, UPC-A, UPC-E y Code 128).
  - Un código cuenta con dos lecturas iguales en menos de 1 s, y el mismo código queda en silencio 2 s (`ScanGate`, T64). La lectura se normaliza como en Android (`ScanCodes`: solo dígitos, de 6 a 14).
  - Sin cámara (o con el permiso negado) dice por qué, y siempre se puede escribir el código.
- **Dónde se escanea:**
  - **W-10:** elige la presentación del código.
  - **W-05:** el diálogo de línea elige la presentación con su último precio en la tienda. Es un código por línea; "Guardar y otro" sigue al siguiente, sin el modo continuo de Android (RF-COM-09).
  - **W-09:** agrega el código a la presentación con la misma revisión que uno tecleado.
  - **W-07:** busca por el código.
- **Código que no está en el catálogo:** W-10 y W-05 no crean productos (como S-13). Lo dicen y ofrecen "Darlo de alta", que abre `/productos/nuevo?codigo=…` con el código ya puesto en la primera presentación.
- **W-10 Precio de anaquel**, con las reglas de Android (`ShelfRepository`, `ShelfPrices`):
  - **Datos:** el producto (búsqueda o escaneo), la tienda y la sucursal (con "Nueva tienda" y "Nueva sucursal", el mismo `PlaceFields` de W-05) y el precio (por kilo si se pesa).
  - **Promoción opcional:** el mismo selector de S-05. Muestra "Con la promoción: $X cada uno · $Y/L", o "Por unidad", o el aviso de MSI.
  - **Precio efectivo:** `shelfEffectiveCents` pasa a `packages/shared` con los casos de `ShelfPricesTest`. Es lo que cuesta una pieza a la cantidad mínima que activa la promoción; en una rebaja el precio "de" es el del anaquel, y con MSI no hay precio efectivo.
  - **Push:** la observación `shelf` de ahora y su fila de `promotions` (`observation_id`, descuento por pieza).
  - **Foto opcional:**
    - Se toma con `<input type="file" accept="image/*" capture="environment">`.
    - Se reduce en el navegador como foto de producto (≤ 2048 px, JPEG 0.85, derecha por su EXIF, sin EXIF en la copia).
    - Su fila `images` (`observation`, `shelf_photo`, `user`) va en el mismo push, y el binario sube después con `PUT /v1/images/:id/blobs/original.jpg`.
    - Si la subida falla, el precio queda guardado y se avisa.
  - **"Recuerda la última":** la tienda y la sucursal del último precio guardado en este navegador (`localStorage`). Android las lee de sus filas; la web no tiene filas.
  - **Al guardar:** "Guardar" abre la ficha del producto. "Guardar y otro" conserva la tienda y dice "Precio guardado".

## 8. Pruebas

- Vitest + Testing Library: editor de compra (totales, promociones, validación), revisión de ticket (estados de línea), formularios de admin.
- Los cálculos vienen de `packages/shared` (ya probados con fixtures).
- Humo con Playwright contra `wrangler dev` (login con usuario de prueba, crear compra, ver historial) en CI opcional.
