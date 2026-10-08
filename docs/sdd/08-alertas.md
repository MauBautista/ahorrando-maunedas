# 08 · Alertas y notificaciones

Requisitos: RF-ALR-01 a 05 (E2). Tablas: `alert_rules` (sync, por usuario), `alert_events` (down, por usuario), `devices`.

## 1. Cuándo se evalúa

Solo al crear una **observación web** (`07-agente.md` §6, compresión por cambio), dentro de `ctx.waitUntil`. Las capturas de anaquel y las compras no disparan alertas, pero sí cuentan para `new_low` con alcance `variant_all`.

## 2. Reglas candidatas

```sql
SELECT r.* FROM alert_rules r
WHERE r.variant_id = ?1
  AND r.active = 1 AND r.deleted_at IS NULL
  AND (r.listing_id IS NULL OR r.listing_id = ?2);
```

Silencio: se descarta la regla si `MAX(alert_events.fired_at)` de esa regla es mayor que `now − cooldown_hours`.

## 3. Semántica

`obs` = observación nueva, `prev` = estado anterior del listing (`listing_state` antes de la ingesta; `null` si es la primera revisión).

| Tipo | Dispara si | Requiere |
|---|---|---|
| `below_price` | `obs.price ≤ umbral` **y** (`prev` es `null` **o** `prev.price > umbral`) | `threshold_cents` |
| `drop_pct` | `prev.price > 0` y `(prev.price − obs.price) / prev.price × 100 ≥ umbral` | `threshold_pct` |
| `new_low` | `obs.cents_per_base < mínimo` del alcance, excluyendo la propia observación; si no hay historial, no dispara | `scope` |
| `back_in_stock` | `prev.in_stock = 0` y `obs.in_stock = 1` | — |
| `promo` | aparece o cambia `promo_text`, **o** aparece precio de lista mayor al precio (antes no había) | — |

Precio usado: `effective_price_cents` si existe, si no `price_cents`.

Mínimo por alcance para `new_low`:

| `scope` | Mínimo sobre |
|---|---|
| `listing` | Observaciones web del mismo listing |
| `variant_web` | Observaciones web de cualquier listing de la variante |
| `variant_all` | `v_price_points` de la variante (compras, anaquel y web) |

```ts
// apps/api/src/alerts/evaluate.ts
export interface ObsView {
  priceCents: number; listPriceCents: number | null; inStock: boolean | null;
  promoText: string | null; centsPerBase: number;
}

export function shouldFire(rule: AlertRuleRow, obs: ObsView, prev: ObsView | null, minCpb: number | null): boolean {
  switch (rule.type) {
    case 'below_price':
      return obs.priceCents <= rule.threshold_cents! &&
        (prev === null || prev.priceCents > rule.threshold_cents!);
    case 'drop_pct':
      return prev !== null && prev.priceCents > 0 &&
        ((prev.priceCents - obs.priceCents) / prev.priceCents) * 100 >= rule.threshold_pct!;
    case 'new_low':
      return minCpb !== null && obs.centsPerBase < minCpb;
    case 'back_in_stock':
      return prev?.inStock === false && obs.inStock === true;
    case 'promo': {
      const promoNew = !!obs.promoText && obs.promoText !== (prev?.promoText ?? null);
      const strikeNow = obs.listPriceCents !== null && obs.listPriceCents > obs.priceCents;
      const strikeBefore = !!prev && prev.listPriceCents !== null && prev.listPriceCents > prev.priceCents;
      return promoNew || (strikeNow && !strikeBefore);
    }
  }
}
```

## 4. Agrupación y prioridad

Si una misma observación dispara varias reglas del **mismo usuario**, se envía **una sola** notificación con el tipo de mayor prioridad y se registra un `alert_event` por regla.

Prioridad: `new_low` > `below_price` > `drop_pct` > `promo` > `back_in_stock`.

## 5. Mensajes

`{p}` = "Producto · Variante", `{t}` = tienda, montos con formato `es-MX`.

| Tipo | Título | Cuerpo |
|---|---|---|
| `new_low` | `Precio más bajo registrado` | `{p} en {t}: {precio} ({precio_unidad}/{unidad}).` |
| `below_price` | `{p} bajó a {precio}` | `En {t}. Tu objetivo: {umbral}.` |
| `drop_pct` | `{p} bajó {pct} %` | `En {t}: de {antes} a {ahora}.` |
| `promo` | `Promoción en {p}` | `{t}: {promo_text}` o `{t}: antes {lista}, ahora {precio}.` |
| `back_in_stock` | `{p} volvió a haber` | `En {t} a {precio}.` |

Avisos de sistema al admin (no generan `alert_event`):

| Evento | Título | Cuerpo |
|---|---|---|
| Agente sin heartbeat ≥ 2 h | `Servidor casero sin conexión` | `El tracking de precios está en pausa desde {hora}.` |
| Listing pasa a `blocked` | `Tienda bloqueando revisiones` | `{t} bloqueó la revisión de {p}. Se reintentará más tarde.` |
| IA al 80 % | `Gasto de IA al {pct} %` | `Llevas {gastado} de {tope} USD este mes.` |

## 6. Entrega (FCM HTTP v1)

Mensajes **solo de datos** con prioridad alta: la app construye la notificación, así el comportamiento y el enlace son iguales en primer y segundo plano.

```ts
// apps/api/src/fcm/send.ts
export type FcmOutcome = 'sent' | 'unregistered' | 'failed';

export async function sendFcm(env: Env, token: string, data: Record<string, string>): Promise<FcmOutcome> {
  const access = await googleAccessToken(env);                  // 02 §5.2
  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/messages:send`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { token, data, android: { priority: 'HIGH', ttl: '86400s' } } }),
    },
  );
  if (res.ok) return 'sent';
  if (res.status === 404) return 'unregistered';
  const body = await res.json<any>().catch(() => null);
  if (JSON.stringify(body).includes('UNREGISTERED')) return 'unregistered';
  return 'failed';
}
```

`data` (todos los valores son texto):

```json
{
  "type": "price_alert",
  "title": "Precio más bajo registrado",
  "body": "Leche Lala Entera · 1 L en Walmart: $24.90 ($24.90/L).",
  "variant_id": "0192…",
  "listing_id": "0192…",
  "event_id": "0192…",
  "channel": "price_alerts"
}
```

Flujo por usuario:

1. Tokens de `devices` del usuario con `fcm_token` no nulo.
2. Enviar a cada uno (≤ 6 en paralelo; límite de subrequests del plan Free: 50 por invocación).
3. `unregistered` → `UPDATE devices SET fcm_token = NULL`.
4. Registrar `alert_events` con `delivery_status` (`sent` si al menos uno llegó, `partial`, `failed`, `no_devices`) en un batch con nueva `version`.

## 7. Android

```kotlin
class MaunedasMessagingService : FirebaseMessagingService() {
    @Inject lateinit var devices: DeviceRegistrar
    @Inject lateinit var notifier: AlertNotifier

    override fun onNewToken(token: String) {
        devices.registerAsync(token)                 // POST /v1/devices
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val d = message.data
        when (d["type"]) {
            "price_alert" -> notifier.showPriceAlert(
                title = d.getValue("title"), body = d.getValue("body"),
                variantId = d.getValue("variant_id"), eventId = d.getValue("event_id"),
            )
            "system" -> notifier.showSystem(d.getValue("title"), d.getValue("body"))
        }
        SyncScheduler.requestSoon(applicationContext)   // baja alert_events y listing_state
    }
}
```

- Canales: `price_alerts` (importancia alta, "Alertas de precio") y `system` (normal, "Avisos del sistema").
- `PendingIntent` con `maunedas://variant/{variantId}`; `setTag(variantId)` para reemplazar avisos repetidos de la misma variante.
- `POST_NOTIFICATIONS` se pide al crear la primera regla (API 33+).

## 8. Pruebas

| # | Caso | Esperado |
|---|---|---|
| 1 | `below_price` 3000; prev 3200 → obs 2900 | dispara |
| 2 | `below_price` 3000; prev 2900 → obs 2800 | no dispara (ya estaba debajo) |
| 3 | `below_price` 3000; prev `null` → obs 2900 | dispara |
| 4 | `drop_pct` 10; prev 1000 → obs 900 | dispara (exactamente 10 %) |
| 5 | `drop_pct` 10; prev 1000 → obs 901 | no dispara |
| 6 | `new_low` `variant_all`; compras mínimas 2.65 ¢/ml; obs web 2.60 ¢/ml | dispara |
| 7 | `new_low` sin historial previo | no dispara |
| 8 | `back_in_stock`; prev 0 → obs 1 | dispara; prev `null` → obs 1: no dispara |
| 9 | `promo`; prev sin tachado → obs con lista 3299 y precio 2899 | dispara; siguiente obs igual: no dispara |
| 10 | Dos reglas del mismo usuario disparan con la misma obs | 1 notificación, 2 `alert_events` |
| 11 | Regla en silencio (evento hace 2 h, `cooldown_hours=24`) | no dispara |
| 12 | Token `UNREGISTERED` | `devices.fcm_token = NULL`, evento `failed` o `partial` |
