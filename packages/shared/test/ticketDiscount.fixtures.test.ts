import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { centsPerBase } from '../src/pricing/units';
import { effectiveUnitCents, prorateTicketDiscount } from '../src/pricing/ticketDiscount';
import { loadFixture } from './fixtures';

const linea = z.strictObject({
  variante: z.strictObject({
    measure: z.enum(['mass', 'volume', 'count']),
    unit_amount: z.number(),
    pack_count: z.number().int(),
    sold_by_weight: z.boolean().optional(),
  }),
  quantity: z.number(),
  final_cents: z.number().int(),
  esperado: z.strictObject({
    paid_cents: z.number(),
    effective_unit_cents: z.number().int(),
    cents_per_base: z.number(),
  }),
});
const { prorrateo_ticket: fixture } = loadFixture(
  'normalizacion.json',
  z.looseObject({
    prorrateo_ticket: z.strictObject({
      descripcion: z.string(),
      casos: z.array(
        z.strictObject({ nombre: z.string(), discount_cents: z.number().int(), lineas: z.array(linea) }),
      ),
      tolerancia: z.number(),
    }),
  }),
);

describe('ticket discount prorating (fixtures/normalizacion.json → prorrateo_ticket)', () => {
  it.each(fixture.casos)('$nombre', ({ discount_cents, lineas }) => {
    const paid = prorateTicketDiscount(
      lineas.map((l) => l.final_cents),
      discount_cents,
    );
    lineas.forEach((l, i) => {
      const { quantity, variante, esperado } = l;
      expect(Math.abs(paid[i]! - esperado.paid_cents)).toBeLessThanOrEqual(fixture.tolerancia);
      expect(effectiveUnitCents(paid[i]!, quantity)).toBe(esperado.effective_unit_cents);
      const cpb = centsPerBase(paid[i]!, quantity, variante.unit_amount, variante.pack_count);
      expect(Math.abs(cpb - esperado.cents_per_base)).toBeLessThanOrEqual(fixture.tolerancia);
    });
  });

  it('paid lines add up to the total minus the discount (up to float error)', () => {
    const paid = prorateTicketDiscount([5700, 2780, 8900], 2000);
    expect(paid.reduce((a, b) => a + b, 0)).toBeCloseTo(17380 - 2000, 9);
  });

  it('rejects negative or fractional cents and non-positive quantities', () => {
    expect(() => prorateTicketDiscount([100], -1)).toThrow(RangeError);
    expect(() => prorateTicketDiscount([100.5], 0)).toThrow(RangeError);
    expect(() => prorateTicketDiscount([-100], 0)).toThrow(RangeError);
    expect(() => effectiveUnitCents(100, 0)).toThrow(RangeError);
  });

  it('an empty purchase has nothing to prorate', () => {
    expect(prorateTicketDiscount([], 500)).toEqual([]);
  });
});
