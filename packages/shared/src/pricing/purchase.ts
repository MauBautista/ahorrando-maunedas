// Purchase arithmetic of the editor (05 §5 S-04, S-05), Kotlin `PurchaseMath` in core:pricing.
import { roundHalfUp } from './rounding';

/** RF-COM-06: more than $1.00 apart asks to confirm. */
export const TOLERANCE_CENTS = 100;

/** A line's money: `final = gross − discount` always (RF-COM-02, `PurchaseItemRowSchema`). */
export interface LineAmounts {
  gross_cents: number;
  discount_cents: number;
  final_cents: number;
}

/** RF-COM-04: 0.845 kg × $32.90 = $27.80 (half-up, as `bruto` in 09 §6.1). */
export function grossCents(quantity: number, unitPriceCents: number): number {
  return roundHalfUp(quantity * unitPriceCents);
}

/**
 * The line with its promotion: [promoDiscountCents] (from `promotionDiscount` or typed by hand) is kept within
 * [0, gross]; a promotion that does not affect the price (MSI) discounts nothing.
 */
export function lineAmounts(
  quantity: number,
  unitPriceCents: number,
  promoDiscountCents: number | null,
  affectsPrice = true,
): LineAmounts {
  const gross = grossCents(quantity, unitPriceCents);
  const discount =
    promoDiscountCents === null || !affectsPrice ? 0 : Math.min(Math.max(promoDiscountCents, 0), gross);
  return { gross_cents: gross, discount_cents: discount, final_cents: gross - discount };
}

/** The footer of S-04: Σ lines, ticket discounts, the computed total and how far it is from the ticket's. */
export interface PurchaseTotals {
  lines_cents: number;
  ticket_discount_cents: number;
  computed_cents: number;
  /** Ticket total − computed total; null when no ticket total was typed. */
  difference_cents: number | null;
  mismatch: boolean;
}

/** Σ final − ticket discounts, never below zero (as `v_price_points` and the list totals). */
export function purchaseTotals(
  lineFinals: readonly number[],
  ticketDiscounts: readonly number[],
  ticketTotalCents: number | null,
): PurchaseTotals {
  const lines = lineFinals.reduce((a, b) => a + b, 0);
  const discounts = ticketDiscounts.reduce((a, b) => a + b, 0);
  const computed = Math.max(0, lines - discounts);
  const difference = ticketTotalCents === null ? null : ticketTotalCents - computed;
  return {
    lines_cents: lines,
    ticket_discount_cents: discounts,
    computed_cents: computed,
    difference_cents: difference,
    mismatch: difference !== null && Math.abs(difference) > TOLERANCE_CENTS,
  };
}
