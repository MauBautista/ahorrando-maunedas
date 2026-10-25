import type { VariantSearchItem } from '@maunedas/shared/api/catalog';
import type { PurchaseDetailResponse, PurchaseListItem } from '@maunedas/shared/api/purchases';

/** 2026-10-25 12:30 in Mexico City. */
export const AT = Date.parse('2026-10-25T18:30:00Z');

export const purchaseLookups = {
  stores: [
    { id: 's-costco', name: 'Costco', kind: 'physical' },
    { id: 's-soriana', name: 'Soriana', kind: 'physical' },
  ],
  store_branches: [{ id: 'b-centro', store_id: 's-costco', name: 'Centro', city: 'Puebla' }],
  categories: [],
  tags: [],
};

const variant = {
  brand: 'Lala',
  measure: 'volume' as const,
  unit_amount: 1000,
  pack_count: 1,
  sold_by_weight: false,
  display_unit: 'L' as const,
};

/** A draft at Costco: 2x1 milk, an unlinked ticket line and weighed ham; a $5.00 coupon and a $72.00 ticket. */
export const purchase: PurchaseDetailResponse = {
  purchase: {
    id: 'pu1',
    store_id: 's-costco',
    branch_id: 'b-centro',
    purchased_at: AT,
    status: 'draft',
    source: 'receipt_ai',
    discount_cents: 500,
    total_cents: 7200,
    notes: null,
    updated_at: 1_000,
  },
  items: [
    {
      id: 'i1',
      line_no: 1,
      variant_id: 'v1',
      raw_text: 'LCH LALA ENT 1L',
      quantity: 2,
      unit_price_cents: 2850,
      gross_cents: 5700,
      discount_cents: 2850,
      final_cents: 2850,
      updated_at: 1_000,
      product_id: 'p1',
      product_name: 'Leche Lala',
      variant_label: '1 L',
      ...variant,
      display_cents: 1331,
    },
    {
      id: 'i2',
      line_no: 2,
      variant_id: null,
      raw_text: 'ABARR VARIOS',
      quantity: 1,
      unit_price_cents: 2000,
      gross_cents: 2000,
      discount_cents: 0,
      final_cents: 2000,
      updated_at: 1_000,
      product_id: null,
      product_name: null,
      brand: null,
      variant_label: null,
      measure: null,
      unit_amount: null,
      pack_count: null,
      sold_by_weight: null,
      display_unit: null,
      display_cents: null,
    },
    {
      id: 'i3',
      line_no: 3,
      variant_id: 'v-jamon',
      raw_text: null,
      quantity: 0.845,
      unit_price_cents: 3290,
      gross_cents: 2780,
      discount_cents: 0,
      final_cents: 2780,
      updated_at: 1_000,
      product_id: 'p-jamon',
      product_name: 'Jamón de pavo',
      variant_label: 'A granel (kg)',
      ...variant,
      brand: null,
      measure: 'mass',
      sold_by_weight: true,
      display_unit: 'kg',
      display_cents: 3108,
    },
  ],
  promotions: [
    {
      id: 'pr1',
      purchase_id: null,
      purchase_item_id: 'i1',
      type: 'nxm',
      params: '{"n":2,"m":1}',
      description: null,
      discount_cents: 2850,
      affects_price: 1,
      created_at: 1_000,
      updated_at: 1_000,
    },
    {
      id: 'pr2',
      purchase_id: 'pu1',
      purchase_item_id: null,
      type: 'coupon',
      params: null,
      description: 'Cupón app',
      discount_cents: 500,
      affects_price: 1,
      created_at: 1_000,
      updated_at: 1_000,
    },
  ],
  receipt_images: [
    {
      image_id: 'img1',
      thumb_url: null,
      processed_url: null,
      original_url: 'https://img.test/t1.jpg',
      license: null,
      attribution: null,
    },
  ],
};

export function listItem(over: Partial<PurchaseListItem>): PurchaseListItem {
  return {
    id: 'pu1',
    store_id: 's-costco',
    branch_id: null,
    purchased_at: AT,
    status: 'confirmed',
    source: 'manual',
    total_cents: null,
    discount_cents: 0,
    lines_total_cents: 0,
    lines: 0,
    receipt_pages: 0,
    ...over,
  };
}

export function found(over: Partial<VariantSearchItem>): VariantSearchItem {
  return {
    variant_id: 'v1',
    product_id: 'p1',
    product_name: 'Leche Lala',
    variant_label: '1 L',
    barcode_match: false,
    image: null,
    last_unit_cents: null,
    ...variant,
    ...over,
  };
}
