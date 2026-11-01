import type { AlertType } from '@maunedas/shared/api/alerts';
import type { DisplayUnit } from '@maunedas/shared/pricing/units';

const money = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
const UNIT: Record<DisplayUnit, string> = { kg: 'kg', '100g': '100 g', L: 'L', '100ml': '100 ml', pz: 'pz' };

/** "$24.90" (whole cents, CLAUDE.md rule 1), as the clients write it. */
export function pesos(cents: number): string {
  return money.format(cents / 100);
}

export interface MessageFacts {
  /** "Producto · Variante". */
  product: string;
  store: string;
  priceCents: number;
  listPriceCents: number | null;
  promoText: string | null;
  /** What one display unit costs at this price, and that unit. */
  perUnitCents: number;
  unit: DisplayUnit;
  prevPriceCents: number | null;
  thresholdCents: number | null;
  /** The promotion that fired is new text (else it is a new strikethrough price). */
  promoIsText: boolean;
}

const clock = new Intl.DateTimeFormat('es-MX', {
  timeZone: 'America/Mexico_City',
  hour: 'numeric',
  minute: '2-digit',
});
const day = new Intl.DateTimeFormat('es-MX', {
  timeZone: 'America/Mexico_City',
  day: 'numeric',
  month: 'short',
});
const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' });

/** "3:05 p.m." when [at] is [now]'s day in Mexico City (CLAUDE.md rule 2); "25 oct, 3:05 p.m." otherwise. */
export function sinceText(at: number, now: number): string {
  const time = clock.format(at).replace(/\s/g, ' ');
  return dayKey.format(at) === dayKey.format(now) ? time : `${day.format(at).replace('.', '')}, ${time}`;
}

/** The admin's system notices of 08 §5 (they make no `alert_event`). */
export const systemMessage = {
  agentOffline: (lastHeartbeat: number, now: number) => {
    const since = sinceText(lastHeartbeat, now);
    // "p.m." already ends the sentence.
    return {
      title: 'Servidor casero sin conexión',
      body: `El tracking de precios está en pausa desde ${since}${since.endsWith('.') ? '' : '.'}`,
    };
  },
  listingBlocked: (store: string, product: string) => ({
    title: 'Tienda bloqueando revisiones',
    body: `${store} bloqueó la revisión de ${product}. Se reintentará más tarde.`,
  }),
  aiSoftLimit: (spentUsd: number, budgetUsd: number) => ({
    title: `Gasto de IA al ${Math.round((spentUsd / budgetUsd) * 100)} %`,
    body: `Llevas ${spentUsd.toFixed(2)} de ${budgetUsd} USD este mes.`,
  }),
};

/** The texts of 08 §5. */
export function alertMessage(type: AlertType, f: MessageFacts): { title: string; body: string } {
  const price = pesos(f.priceCents);
  switch (type) {
    case 'new_low':
      return {
        title: 'Precio más bajo registrado',
        body: `${f.product} en ${f.store}: ${price} (${pesos(f.perUnitCents)}/${UNIT[f.unit]}).`,
      };
    case 'below_price':
      return {
        title: `${f.product} bajó a ${price}`,
        body: `En ${f.store}. Tu objetivo: ${pesos(f.thresholdCents ?? 0)}.`,
      };
    case 'drop_pct': {
      const before = f.prevPriceCents ?? f.priceCents;
      const pct = Math.round(((before - f.priceCents) / before) * 100);
      return { title: `${f.product} bajó ${pct} %`, body: `En ${f.store}: de ${pesos(before)} a ${price}.` };
    }
    case 'promo':
      return {
        title: `Promoción en ${f.product}`,
        body:
          f.promoIsText && f.promoText
            ? `${f.store}: ${f.promoText}`
            : `${f.store}: antes ${pesos(f.listPriceCents ?? f.priceCents)}, ahora ${price}.`,
      };
    case 'back_in_stock':
      return { title: `${f.product} volvió a haber`, body: `En ${f.store} a ${price}.` };
  }
}
