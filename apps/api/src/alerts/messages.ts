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
