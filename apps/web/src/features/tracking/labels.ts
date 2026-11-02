import type { AlertRuleItem, AlertScope, AlertType, DeliveryStatus } from '@maunedas/shared/api/alerts';
import type { ListingWithState } from '@maunedas/shared/api/listings';
import type { UnsupportedUrlReason } from '@maunedas/shared/api/listings';
import { formatMoney } from '../../lib/format';

/** "Leche Lala Entera · 1 L", as the alert messages (08 §5). */
export function subjectName(s: { product_name: string | null; variant_label: string | null }): string {
  return [s.product_name, s.variant_label].filter(Boolean).join(' · ');
}

export type ListingHealth = 'paused' | 'waiting' | 'ok' | 'out_of_stock' | 'not_found' | 'blocked' | 'error';

/** Where a listing stands, from `active` and its last check (`listing_state`). */
export function listingHealth(l: ListingWithState): ListingHealth {
  if (l.active !== 1) return 'paused';
  const s = l.state;
  if (!s || s.last_status === null || s.last_status === 'pending') return 'waiting';
  if (s.last_status === 'ok') return s.last_in_stock === 0 ? 'out_of_stock' : 'ok';
  return s.last_status;
}

export const HEALTH_LABEL: Record<ListingHealth, string> = {
  paused: 'En pausa',
  waiting: 'Por revisar',
  ok: 'Al día',
  out_of_stock: 'Agotado',
  not_found: 'Ya no existe',
  blocked: 'Bloqueado',
  error: 'Con error',
};

export const HEALTH_HELP: Partial<Record<ListingHealth, string>> = {
  paused: 'No se revisa hasta que lo reanudes.',
  waiting: 'El servidor casero lo revisará en unos minutos.',
  not_found: 'La tienda ya no tiene esta página.',
  blocked: 'La tienda está bloqueando las revisiones; se reintentará más tarde.',
  error: 'No se pudo leer la página; se reintentará más tarde.',
};

/** Whether "Revisar ahora" was asked and its check has not arrived yet. */
export function checkRequested(l: ListingWithState): boolean {
  const s = l.state;
  return !!s?.check_requested_at && s.check_requested_at > (s.last_checked_at ?? 0);
}

/** "Cada 8 h", "Cada 90 min"; null when the store's interval applies. */
export function intervalText(minutes: number | null): string | null {
  return minutes === null ? null : `Cada ${spanText(minutes)}`;
}

/** "8 h", or "90 min" when it is not whole hours. */
export function spanText(minutes: number): string {
  return minutes % 60 === 0 ? `${minutes / 60} h` : `${minutes} min`;
}

/** RF-TRK-02 (T-224, decisión T100): the store's interval (null), then 2 h, 4 h, 12 h and a day. */
export const INTERVAL_OPTIONS: ReadonlyArray<number | null> = [null, 120, 240, 720, 1440];

/** Why a link cannot be followed (`422 E-UNSUPPORTED_URL`, T-210). */
export const UNSUPPORTED_REASON: Record<UnsupportedUrlReason, string> = {
  NO_URL: 'No encontramos un enlace en lo que pegaste.',
  SHORT_LINK: 'No pudimos abrir ese enlace corto. Copia el enlace completo de la página del producto.',
  NOT_TRACKED:
    'Ese enlace no se puede seguir: por ahora solo productos de Amazon, Sam’s Club y Costco (Walmart bloquea las revisiones).',
  NO_STORE: 'Falta dar de alta esa tienda. Avísale a quien administra la app.',
};

export const RULE_TYPES: Array<{ value: AlertType; label: string }> = [
  { value: 'below_price', label: 'Baja a un precio' },
  { value: 'drop_pct', label: 'Baja un porcentaje' },
  { value: 'new_low', label: 'Precio más bajo registrado' },
  { value: 'promo', label: 'Aparece una promoción' },
  { value: 'back_in_stock', label: 'Vuelve a haber' },
];

export const SCOPES: Array<{ value: AlertScope; label: string }> = [
  { value: 'variant_web', label: 'Entre los precios en línea de la presentación' },
  { value: 'variant_all', label: 'Entre todos los precios: compras, anaquel y en línea' },
  { value: 'listing', label: 'Entre los precios del mismo enlace' },
];

/** "Si baja a $25.00 o menos", as the rule list says it. */
export function ruleText(
  r: Pick<AlertRuleItem, 'type' | 'threshold_cents' | 'threshold_pct' | 'scope'>,
): string {
  switch (r.type) {
    case 'below_price':
      return `Si baja a ${formatMoney(r.threshold_cents ?? 0)} o menos`;
    case 'drop_pct':
      return `Si baja ${r.threshold_pct ?? 0} % o más de una revisión a otra`;
    case 'new_low':
      return r.scope === 'variant_all'
        ? 'Si llega al precio más bajo registrado (compras, anaquel y en línea)'
        : r.scope === 'listing'
          ? 'Si llega al precio más bajo visto en el mismo enlace'
          : 'Si llega al precio en línea más bajo de la presentación';
    case 'promo':
      return 'Si aparece una promoción o un precio tachado';
    case 'back_in_stock':
      return 'Si vuelve a haber';
  }
}

export const DELIVERY_LABEL: Record<DeliveryStatus, string> = {
  sent: 'Notificación enviada',
  partial: 'Enviada a algunos teléfonos',
  failed: 'No se pudo enviar la notificación',
  no_devices: 'Sin teléfono registrado: solo aquí',
};
