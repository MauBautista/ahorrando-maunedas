import { describe, expect, it } from 'vitest';
import { qualifyingQuantity, shelfEffectiveCents } from '../src/pricing/shelf';

/** The cases of Kotlin `ShelfPricesTest` (core:pricing). */
describe('shelf prices (S-13)', () => {
  it('gives the price per unit at the quantity that triggers the promotion', () => {
    // 2x1 of $89.00: two for $89.00, $44.50 each.
    expect(shelfEffectiveCents('nxm', { n: 2, m: 1 }, 8_900)).toBe(4_450);
    // 3x2 of $25.00: $50.00 for three, $16.67 each (half-up).
    expect(shelfEffectiveCents('nxm', { n: 3, m: 2 }, 2_500)).toBe(1_667);
    // Second at 50 % of $40.00: $60.00 for two.
    expect(shelfEffectiveCents('nth_unit_discount', { nth: 2, percent: 50 }, 4_000)).toBe(3_000);
    expect(shelfEffectiveCents('percent', { percent: 15 }, 12_000)).toBe(10_200);
    // A price cut from the shelf price to $29.90.
    expect(shelfEffectiveCents('price_cut', { to_cents: 2_990 }, 3_500)).toBe(2_990);
    expect(shelfEffectiveCents('member_price', { member_cents: 2_700 }, 2_990)).toBe(2_700);
    expect(shelfEffectiveCents('coupon', { amount_cents: 500 }, 3_000)).toBe(2_500);
  });

  it('changes nothing with MSI or an incomplete promotion', () => {
    expect(shelfEffectiveCents('msi', { months: 12 }, 899_900)).toBeNull();
    expect(shelfEffectiveCents('nxm', { n: 2 }, 8_900)).toBeNull();
    // A coupon larger than the price leaves $0, never negative.
    expect(shelfEffectiveCents('coupon', { amount_cents: 9_000 }, 3_000)).toBe(0);
    expect(qualifyingQuantity('nxm', {})).toBe(1);
  });
});
