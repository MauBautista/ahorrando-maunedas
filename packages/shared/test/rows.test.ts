import { describe, expect, it } from 'vitest';
import { TABLES } from '../src/sync/registry';
import {
  AlertRuleRowSchema,
  BarcodeRowSchema,
  CategoryRowSchema,
  ImageRenditionRowSchema,
  ImageRowSchema,
  ListingRowSchema,
  ProductRowSchema,
  ProductTagRowSchema,
  PromotionRowSchema,
  PurchaseItemRowSchema,
  ReceiptAliasRowSchema,
  StoreRowSchema,
  VariantRowSchema,
} from '../src/sync/rows';
import { productTagId, receiptAliasId } from '../src/util/uuid';

const ID = '0192a5e0-7c3e-7b2a-9f1d-3c4b5a6d7e8f';
const ID2 = '0192a5e1-1a2b-7c3d-8e4f-5a6b7c8d9e0f';
const ID3 = '0192a5e2-2b3c-7d4e-9f50-6a7b8c9d0e1f';
const meta = { id: ID, created_at: 1, updated_at: 2 };

const ok = (schema: { safeParse: (v: unknown) => { success: boolean } }, row: unknown) =>
  expect(schema.safeParse(row).success).toBe(true);
const bad = (schema: { safeParse: (v: unknown) => { success: boolean } }, row: unknown) =>
  expect(schema.safeParse(row).success).toBe(false);

describe('compatibility rule (04 §3.3)', () => {
  it('a minimal row with only required columns is valid; optional columns may be absent', () => {
    ok(ProductRowSchema, { ...meta, name: 'Leche Lala Entera' });
    ok(StoreRowSchema, { ...meta, name: 'Costco', kind: 'both' });
  });

  it('required NOT NULL columns without default cannot be absent', () => {
    bad(ProductRowSchema, { ...meta });
    bad(StoreRowSchema, { ...meta, name: 'Costco' });
  });

  it('nullable columns accept null (set NULL)', () => {
    ok(ProductRowSchema, { ...meta, name: 'Leche', brand: null, category_id: null, deleted_at: null });
  });
});

describe('row rules (04 §2)', () => {
  it('purchase_items: final = gross − discount, quantity > 0', () => {
    const line = {
      ...meta,
      purchase_id: ID2,
      line_no: 1,
      quantity: 2,
      unit_price_cents: 8900,
      gross_cents: 17800,
      discount_cents: 8900,
      final_cents: 8900,
    };
    ok(PurchaseItemRowSchema, line);
    ok(PurchaseItemRowSchema, { ...line, quantity: 0.845, variant_id: null });
    bad(PurchaseItemRowSchema, { ...line, final_cents: 9000 });
    bad(PurchaseItemRowSchema, { ...line, quantity: 0 });
    bad(PurchaseItemRowSchema, { ...line, discount_cents: -1, final_cents: 17801 });
    bad(PurchaseItemRowSchema, { ...line, unit_price_cents: 89.5 });
  });

  it('promotions: exactly one owner', () => {
    const promo = { ...meta, purchase_id: null, purchase_item_id: ID2, observation_id: null, type: 'nxm' };
    ok(PromotionRowSchema, promo);
    bad(PromotionRowSchema, { ...promo, purchase_id: ID3 });
    bad(PromotionRowSchema, { ...promo, purchase_item_id: null });
    bad(PromotionRowSchema, { ...meta, purchase_item_id: ID2, type: 'nxm' }); // owners must travel
  });

  it('product_tags: id = uuidv5(product_id:tag_id)', () => {
    const row = { ...meta, id: productTagId(ID2, ID3), product_id: ID2, tag_id: ID3 };
    ok(ProductTagRowSchema, row);
    bad(ProductTagRowSchema, { ...row, id: ID });
  });

  it('receipt_aliases: normalized text and id = uuidv5(store_id:raw_text_norm)', () => {
    const row = {
      ...meta,
      id: receiptAliasId(ID2, 'LCH LALA ENT 1L'),
      store_id: ID2,
      raw_text_norm: 'LCH LALA ENT 1L',
      variant_id: ID3,
    };
    ok(ReceiptAliasRowSchema, row);
    bad(ReceiptAliasRowSchema, { ...row, id: ID });
    bad(ReceiptAliasRowSchema, {
      ...row,
      raw_text_norm: 'lch lala ent 1l   28.50',
      id: receiptAliasId(ID2, 'lch lala ent 1l   28.50'),
    });
  });

  it('images: original_key = images/{id}/original.{ext}', () => {
    const img = { ...meta, owner_type: 'product', owner_id: ID2, role: 'catalog', source: 'user' };
    ok(ImageRowSchema, { ...img, original_key: null });
    ok(ImageRowSchema, { ...img, original_key: `images/${ID}/original.jpg` });
    bad(ImageRowSchema, { ...img, original_key: `images/${ID2}/original.jpg` });
    bad(ImageRowSchema, { ...img, original_key: `images/${ID}/original.gif` });
    bad(ImageRowSchema, { ...img, edit_params: '{not json' });
  });

  it('image_renditions: r2_key = images/{image_id}/{id}.{webp|png}', () => {
    const r = { ...meta, image_id: ID2, kind: 'thumb', tier: 'device', r2_key: `images/${ID2}/${ID}.webp` };
    ok(ImageRenditionRowSchema, r);
    bad(ImageRenditionRowSchema, { ...r, r2_key: `images/${ID2}/${ID3}.webp` });
    bad(ImageRenditionRowSchema, { ...r, r2_key: `images/${ID2}/${ID}.jpg` });
  });

  it('listings: only known adapters (Walmart is not tracked, T34) and intervals ≥ 1 h', () => {
    const l = {
      ...meta,
      variant_id: ID2,
      store_id: ID3,
      adapter: 'amazon_mx',
      url: 'https://www.amazon.com.mx/dp/B0D364NN9H',
    };
    ok(ListingRowSchema, l);
    bad(ListingRowSchema, { ...l, adapter: 'walmart_mx' });
    bad(ListingRowSchema, { ...l, check_interval_min: 15 });
    bad(ListingRowSchema, { ...l, url: 'javascript:alert(1)' });
  });

  it('variants: bulk (a granel) only for mass, 1000 g, pack of 1', () => {
    const v = { ...meta, product_id: ID2, label: 'A granel (kg)', measure: 'mass', unit_amount: 1000 };
    ok(VariantRowSchema, { ...v, sold_by_weight: 1 });
    bad(VariantRowSchema, { ...v, sold_by_weight: 1, measure: 'volume' });
    bad(VariantRowSchema, { ...v, sold_by_weight: 1, pack_count: 6 });
    bad(VariantRowSchema, { ...v, unit_amount: 0 });
    bad(VariantRowSchema, { ...v, sold_by_weight: true });
  });

  it('barcodes: 6 to 14 digits', () => {
    const b = { ...meta, variant_id: ID2, code: '7501020515343', source: 'scan' };
    ok(BarcodeRowSchema, b);
    bad(BarcodeRowSchema, { ...b, code: '12345' });
    bad(BarcodeRowSchema, { ...b, code: '75010205153AB' });
  });

  it('categories: a category cannot be its own parent', () => {
    ok(CategoryRowSchema, { ...meta, name: 'Lácteos', parent_id: ID2 });
    bad(CategoryRowSchema, { ...meta, name: 'Lácteos', parent_id: ID });
  });

  it('alert_rules: thresholds required by type', () => {
    const r = { ...meta, user_id: ID2, variant_id: ID3, type: 'below_price' };
    ok(AlertRuleRowSchema, { ...r, threshold_cents: 3000 });
    bad(AlertRuleRowSchema, r);
    bad(AlertRuleRowSchema, { ...r, type: 'drop_pct' });
    ok(AlertRuleRowSchema, { ...r, type: 'drop_pct', threshold_pct: 10 });
  });

  it('names are trimmed, non-empty and at most 200 characters', () => {
    bad(ProductRowSchema, { ...meta, name: '   ' });
    bad(ProductRowSchema, { ...meta, name: 'x'.repeat(201) });
    expect(ProductRowSchema.parse({ ...meta, name: '  Leche  ' }).name).toBe('Leche');
  });
});

describe('derived columns', () => {
  it('products.search_key is recomputed from name and brand', () => {
    const derive = TABLES.products.derive;
    expect(derive).toBeTypeOf('function');
    const derived = derive?.({ name: 'Café Legal', brand: 'Legal', search_key: 'manipulado' }) ?? {};
    expect(derived.search_key).toBe('cafe legal legal');
  });
});
