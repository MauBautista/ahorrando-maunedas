import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  NS_PRODUCT_TAGS,
  NS_RECEIPT_ALIASES,
  productTagId,
  receiptAliasId,
  uuidv5,
  uuidv7,
} from '../src/util/uuid';
import { loadFixture } from './fixtures';

const fixture = loadFixture(
  'ids.json',
  z.strictObject({
    descripcion: z.string(),
    namespaces: z.strictObject({ NS_PRODUCT_TAGS: z.uuid(), NS_RECEIPT_ALIASES: z.uuid() }),
    uuidv5: z.array(
      z.strictObject({ nombre: z.string(), namespace: z.uuid(), entrada: z.string(), esperado: z.uuid() }),
    ),
    product_tag_id: z.array(
      z.strictObject({ nombre: z.string(), product_id: z.string(), tag_id: z.string(), esperado: z.uuid() }),
    ),
    receipt_alias_id: z.array(
      z.strictObject({
        nombre: z.string(),
        store_id: z.string(),
        raw_text_norm: z.string(),
        esperado: z.uuid(),
      }),
    ),
  }),
);

describe('ids.json', () => {
  it('uses the fixed namespaces', () => {
    expect({ NS_PRODUCT_TAGS, NS_RECEIPT_ALIASES }).toEqual(fixture.namespaces);
  });

  it.each(fixture.uuidv5)('uuidv5: $nombre', (c) => {
    expect(uuidv5(c.entrada, c.namespace)).toBe(c.esperado);
  });

  it.each(fixture.product_tag_id)('productTagId: $nombre', (c) => {
    expect(productTagId(c.product_id, c.tag_id)).toBe(c.esperado);
  });

  it.each(fixture.receipt_alias_id)('receiptAliasId: $nombre', (c) => {
    expect(receiptAliasId(c.store_id, c.raw_text_norm)).toBe(c.esperado);
  });
});

describe('uuidv7', () => {
  const V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it('has version 7 and the RFC variant', () => {
    expect(uuidv7()).toMatch(V7);
  });

  it('embeds the timestamp and sorts by time', () => {
    const a = uuidv7(1_759_255_200_000);
    const b = uuidv7(1_759_255_200_001);
    expect(parseInt(a.replace(/-/g, '').slice(0, 12), 16)).toBe(1_759_255_200_000);
    expect(a < b).toBe(true);
  });
});
