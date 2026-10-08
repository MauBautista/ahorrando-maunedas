import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { centsPerBase, defaultDisplayUnit, displayCents, type DisplayUnit } from '../src/pricing/units';
import { loadFixture } from './fixtures';

const displayUnit = z.enum(['kg', '100g', 'L', '100ml', 'pz']);
const variante = z.strictObject({
  measure: z.enum(['mass', 'volume', 'count']),
  unit_amount: z.number(),
  pack_count: z.number().int(),
  sold_by_weight: z.boolean().optional(),
});
const fixture = loadFixture(
  'normalizacion.json',
  z.strictObject({
    descripcion: z.string(),
    base_por_unidad_display: z.record(displayUnit, z.number()),
    casos: z.array(
      z.strictObject({
        nombre: z.string(),
        variante,
        paid_cents: z.number().int(),
        quantity: z.number(),
        esperado: z.strictObject({
          cents_per_base: z.number(),
          display: z.partialRecord(displayUnit, z.number().int()),
        }),
      }),
    ),
    errores: z.array(
      z.strictObject({
        nombre: z.string(),
        variante,
        paid_cents: z.number().int(),
        quantity: z.number(),
        display_unit: displayUnit.optional(),
        esperado: z.literal('error'),
      }),
    ),
    tolerancia_cents_per_base: z.number(),
  }),
);

describe('normalizacion.json', () => {
  it.each(fixture.casos)('$nombre', (c) => {
    const cpb = centsPerBase(c.paid_cents, c.quantity, c.variante.unit_amount, c.variante.pack_count);
    expect(Math.abs(cpb - c.esperado.cents_per_base)).toBeLessThanOrEqual(fixture.tolerancia_cents_per_base);
    for (const [unit, cents] of Object.entries(c.esperado.display)) {
      expect(displayCents(cpb, c.variante.measure, unit as DisplayUnit)).toBe(cents);
    }
  });

  it.each(fixture.errores)('error: $nombre', (c) => {
    expect(() => {
      const cpb = centsPerBase(c.paid_cents, c.quantity, c.variante.unit_amount, c.variante.pack_count);
      if (c.display_unit) displayCents(cpb, c.variante.measure, c.display_unit);
    }).toThrow();
  });
});

describe('defaultDisplayUnit', () => {
  it('suggests kg, L and pz', () => {
    expect([defaultDisplayUnit('mass'), defaultDisplayUnit('volume'), defaultDisplayUnit('count')]).toEqual([
      'kg',
      'L',
      'pz',
    ]);
  });
});
