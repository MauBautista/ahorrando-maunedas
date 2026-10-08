import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { normalizeReceiptText } from '../src/receipts/normalize';
import { searchKey } from '../src/text/searchKey';
import { loadFixture } from './fixtures';

const pair = z.strictObject({ entrada: z.string(), esperado: z.string() });
const fixture = loadFixture(
  'textos.json',
  z.strictObject({ descripcion: z.string(), search_key: z.array(pair), raw_text_norm: z.array(pair) }),
);

describe('textos.json · search_key', () => {
  it.each(fixture.search_key)('"$entrada"', (c) => {
    expect(searchKey(c.entrada)).toBe(c.esperado);
  });
});

describe('textos.json · raw_text_norm', () => {
  it.each(fixture.raw_text_norm)('"$entrada"', (c) => {
    expect(normalizeReceiptText(c.entrada)).toBe(c.esperado);
  });
});
