import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseQuantity, suggestVariantLabel } from '../src/catalog/quantity';
import { loadFixture } from './fixtures';

const fixture = loadFixture(
  'cantidades.json',
  z.strictObject({
    descripcion: z.string(),
    casos: z.array(
      z.strictObject({
        entrada: z.string(),
        esperado: z
          .strictObject({
            measure: z.enum(['mass', 'volume', 'count']),
            unit_amount: z.number(),
            pack_count: z.number().int(),
          })
          .nullable(),
        etiqueta: z.string().optional(),
      }),
    ),
  }),
);

describe('cantidades.json', () => {
  it.each(fixture.casos)('"$entrada"', (c) => {
    const parsed = parseQuantity(c.entrada);
    expect(parsed).toEqual(c.esperado);
    if (parsed && c.etiqueta !== undefined) expect(suggestVariantLabel(parsed)).toBe(c.etiqueta);
  });
});
