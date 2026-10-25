import { describe, expect, it } from 'vitest';
import { promotionDiscount } from '../src/pricing/promotions';
import { grossCents, lineAmounts, purchaseTotals } from '../src/pricing/purchase';

/** The cases of Kotlin `PurchaseMathTest` (core:pricing), so the web's editor adds up as Android's. */
describe('purchase math (S-04, S-05)', () => {
  it('rounds bulk half-up (RF-COM-04)', () => {
    expect(grossCents(0.845, 3_290)).toBe(2_780);
    // 2.5 cents round up, never to even.
    expect(grossCents(0.5, 5)).toBe(3);
  });

  it('keeps final equal to gross minus discount', () => {
    // 2x1 of $89.00 with 2 pieces.
    const twoForOne = promotionDiscount('nxm', { n: 2, m: 1 }, 2, 8_900);
    expect(lineAmounts(2, 8_900, twoForOne)).toEqual({
      gross_cents: 17_800,
      discount_cents: 8_900,
      final_cents: 8_900,
    });
    // A hand-typed discount above the gross leaves $0, never negative.
    expect(lineAmounts(1, 1_000, 5_000).final_cents).toBe(0);
    // MSI does not change the price.
    expect(lineAmounts(1, 12_000, 3_000, false)).toEqual({
      gross_cents: 12_000,
      discount_cents: 0,
      final_cents: 12_000,
    });
    expect(lineAmounts(1, 500, null)).toEqual({ gross_cents: 500, discount_cents: 0, final_cents: 500 });
  });

  it('counts the difference only above one peso (RF-COM-06)', () => {
    expect(purchaseTotals([10_000, 5_050], [500], 14_450)).toEqual({
      lines_cents: 15_050,
      ticket_discount_cents: 500,
      computed_cents: 14_550,
      difference_cents: -100,
      mismatch: false,
    });
    expect(purchaseTotals([10_000], [], 10_101).mismatch).toBe(true);
    expect(purchaseTotals([10_000], [], null).difference_cents).toBeNull();
    // Ticket discounts above the lines leave a $0 total.
    expect(purchaseTotals([300], [500], null).computed_cents).toBe(0);
  });
});
