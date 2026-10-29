import type { AlertType } from '@maunedas/shared/api/alerts';

export interface AlertRuleRow {
  id: string;
  user_id: string;
  variant_id: string;
  listing_id: string | null;
  type: AlertType;
  threshold_cents: number | null;
  threshold_pct: number | null;
  scope: 'listing' | 'variant_web' | 'variant_all';
  cooldown_hours: number;
}

/** An observation, or the listing's state before it, as the rules read it (08 §3). */
export interface ObsView {
  /** `effective_price_cents` if any, else `price_cents`; null when the state had no price. */
  priceCents: number | null;
  listPriceCents: number | null;
  inStock: boolean | null;
  promoText: string | null;
}

/** 08 §4: one notification per user takes the first of these. */
export const PRIORITY: readonly AlertType[] = [
  'new_low',
  'below_price',
  'drop_pct',
  'promo',
  'back_in_stock',
];

/**
 * 08 §3. [obs] is the new web observation (it always has a price); [prev] the listing's state before it, null on
 * its first check; [minCpb] the lowest price per base unit of the rule's scope without this observation, null when
 * there is no history. A previous state without a price counts as no previous price.
 */
export function shouldFire(
  rule: Pick<AlertRuleRow, 'type' | 'threshold_cents' | 'threshold_pct'>,
  obs: ObsView & { priceCents: number; centsPerBase: number },
  prev: ObsView | null,
  minCpb: number | null,
): boolean {
  switch (rule.type) {
    case 'below_price':
      return (
        rule.threshold_cents !== null &&
        obs.priceCents <= rule.threshold_cents &&
        (prev?.priceCents == null || prev.priceCents > rule.threshold_cents)
      );
    case 'drop_pct':
      return (
        rule.threshold_pct !== null &&
        prev?.priceCents != null &&
        prev.priceCents > 0 &&
        ((prev.priceCents - obs.priceCents) / prev.priceCents) * 100 >= rule.threshold_pct
      );
    case 'new_low':
      return minCpb !== null && obs.centsPerBase < minCpb;
    case 'back_in_stock':
      return prev?.inStock === false && obs.inStock === true;
    case 'promo': {
      const promoNew = !!obs.promoText && obs.promoText !== (prev?.promoText ?? null);
      const strikeNow = obs.listPriceCents !== null && obs.listPriceCents > obs.priceCents;
      const strikeBefore =
        !!prev &&
        prev.listPriceCents !== null &&
        prev.priceCents !== null &&
        prev.listPriceCents > prev.priceCents;
      return promoNew || (strikeNow && !strikeBefore);
    }
  }
}
