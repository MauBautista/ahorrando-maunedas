import { roundHalfUp } from './rounding';

function assertCents(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0)
    throw new RangeError(`${name} debe ser un entero de centavos ≥ 0`);
}

/**
 * Paid cents of each line after prorating a ticket-level discount (RF-COM-05) in proportion to the
 * final_cents of each live line: paid = final × (1 − min(discount, Σ final) / Σ final), or final when
 * Σ final = 0. Same operations, in the same order, as `v_price_points` (esquema-d1.sql), so D1, Room and
 * this function produce the same floats. Not rounded: effective unit price and cents per base derive from it.
 */
export function prorateTicketDiscount(finalCents: readonly number[], discountCents: number): number[] {
  assertCents(discountCents, 'discount_cents');
  finalCents.forEach((f) => assertCents(f, 'final_cents'));
  const total = finalCents.reduce((sum, f) => sum + f, 0);
  const factor = total > 0 ? 1 - Math.min(discountCents, total) / total : 1;
  return finalCents.map((f) => f * factor);
}

/** Effective price per unit of quantity (per piece, kg…), as `v_price_points.effective_unit_cents`. */
export function effectiveUnitCents(paidCents: number, quantity: number): number {
  if (!(quantity > 0)) throw new RangeError('La cantidad debe ser mayor que 0');
  return roundHalfUp(paidCents / quantity);
}
