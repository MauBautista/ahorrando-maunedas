import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { affectsPrice, detectPromotion, promotionDiscount } from '../src/pricing/promotions';
import { loadFixture } from './fixtures';

const promoType = z.enum([
  'price_cut',
  'percent',
  'nxm',
  'nth_unit_discount',
  'member_price',
  'coupon',
  'msi',
  'bundle',
  'other',
]);
const params = z.strictObject({
  from_cents: z.number().optional(),
  to_cents: z.number().optional(),
  percent: z.number().optional(),
  n: z.number().optional(),
  m: z.number().optional(),
  nth: z.number().optional(),
  member_cents: z.number().optional(),
  program: z.string().optional(),
  code: z.string().optional(),
  amount_cents: z.number().optional(),
  months: z.number().optional(),
  text: z.string().optional(),
});
const fixture = loadFixture(
  'promociones.json',
  z.strictObject({
    descripcion: z.string(),
    descuentos: z.array(
      z.strictObject({
        nombre: z.string(),
        type: promoType,
        params,
        unit_price_cents: z.number().int(),
        quantity: z.number(),
        esperado: z.number().int(),
      }),
    ),
    deteccion: z.array(
      z.strictObject({ texto: z.string(), type: promoType.nullable(), params: params.nullable() }),
    ),
  }),
);

describe('promociones.json · descuentos', () => {
  it.each(fixture.descuentos)('$nombre', (c) => {
    expect(promotionDiscount(c.type, c.params, c.quantity, c.unit_price_cents)).toBe(c.esperado);
  });
});

describe('promociones.json · deteccion', () => {
  it.each(fixture.deteccion)('"$texto"', (c) => {
    const expected = c.type === null ? null : { type: c.type, params: c.params };
    expect(detectPromotion(c.texto)).toEqual(expected);
  });
});

describe('promotions', () => {
  it('requires the parameters of the type', () => {
    expect(() => promotionDiscount('nxm', { n: 2 }, 2, 100)).toThrow(RangeError);
  });

  it('never discounts more than the line gross', () => {
    expect(promotionDiscount('coupon', { amount_cents: 5000 }, 1, 3000)).toBe(3000);
  });

  it('marks MSI as not affecting the price', () => {
    expect(affectsPrice('msi')).toBe(false);
    expect(affectsPrice('nxm')).toBe(true);
  });
});
