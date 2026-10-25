// A shelf price with a promotion (05 §5 S-13, RF-PRE-01), Kotlin `ShelfPrices` in core:pricing.
import { type PromoParams, type PromoType, promotionDiscount } from './promotions';
import { lineAmounts } from './purchase';
import { roundHalfUp } from './rounding';

/** n for NxM, the n-th unit for nth_unit_discount, otherwise one piece: the smallest quantity that triggers it. */
export function qualifyingQuantity(type: PromoType, params: PromoParams): number {
  const at = (v: number | undefined) => (v !== undefined && v >= 1 ? Math.floor(v) : 1);
  if (type === 'nxm') return at(params.n);
  if (type === 'nth_unit_discount') return at(params.nth);
  return 1;
}

/**
 * What one unit costs with the promotion at [qualifyingQuantity] (`effective_price_cents`), or null when it does not
 * change the price (MSI) or its parameters are incomplete. price_cut starts from the shelf price, as in S-05.
 */
export function shelfEffectiveCents(type: PromoType, params: PromoParams, priceCents: number): number | null {
  if (type === 'msi') return null;
  const p = type === 'price_cut' ? { ...params, from_cents: priceCents } : params;
  const q = qualifyingQuantity(type, p);
  let discount: number;
  try {
    discount = promotionDiscount(type, p, q, priceCents);
  } catch {
    return null;
  }
  return roundHalfUp(lineAmounts(q, priceCents, discount).final_cents / q);
}
