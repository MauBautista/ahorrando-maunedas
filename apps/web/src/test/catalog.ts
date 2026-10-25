import type { ProductDetailResponse } from '@maunedas/shared/api/catalog';

export const NOW = Date.now();
export const DAY = 86_400_000;

export const lookups = {
  stores: [
    { id: 's-soriana', name: 'Soriana', kind: 'physical' },
    { id: 's-costco', name: 'Costco', kind: 'physical' },
  ],
  store_branches: [],
  categories: [
    { id: 'c-lacteos', parent_id: 'c-refri', name: 'Lácteos', sort_order: 1 },
    { id: 'c-refri', parent_id: null, name: 'Refrigerados', sort_order: 1 },
  ],
  tags: [{ id: 't-basicos', name: 'Básicos' }],
};

export const detail: ProductDetailResponse = {
  product: {
    id: 'p1',
    name: 'Leche Lala Entera',
    brand: 'Lala',
    category_id: 'c-lacteos',
    display_unit: 'L',
    notes: null,
    primary_image_id: null,
    updated_at: 1_000,
    tags: [{ id: 't-basicos', name: 'Básicos' }],
    image: null,
  },
  variants: [
    {
      id: 'v1',
      product_id: 'p1',
      label: '1 L',
      measure: 'volume',
      unit_amount: 1000,
      pack_count: 1,
      sold_by_weight: 0,
      primary_image_id: null,
      updated_at: 1_000,
      barcodes: ['7501020515343'],
      barcode_rows: [{ id: 'b1', code: '7501020515343', updated_at: 1_000 }],
      image: null,
      latest: [
        {
          store_id: 's-soriana',
          source: 'purchase',
          effective_unit_cents: 2_850,
          display_cents: 2_850,
          display_unit: 'L',
          observed_at: NOW - 2 * DAY,
        },
      ],
    },
    {
      id: 'v2',
      product_id: 'p1',
      label: 'A granel (kg)',
      measure: 'mass',
      unit_amount: 1000,
      pack_count: 1,
      sold_by_weight: 1,
      primary_image_id: null,
      updated_at: 1_000,
      barcodes: [],
      barcode_rows: [],
      image: null,
      latest: [],
    },
  ],
};
