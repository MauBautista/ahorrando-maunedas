import { productTagId } from '@maunedas/shared/util/uuid';
import { describe, expect, it } from 'vitest';
import { detail } from '../../../test/catalog';
import { deleteProductMutations, productMutations, variantMutations } from './mutations';

const NOW = 5_000;

describe('push rows of the editor (04 §7)', () => {
  it('creates a product with a new tag, its tag links and its first variant with a code', () => {
    const { productId, mutations } = productMutations(
      {
        name: 'Leche',
        brand: 'Lala',
        categoryId: null,
        tagIds: ['t-basicos'],
        newTags: ['Lácteos'],
        displayUnit: 'L',
        notes: null,
      },
      null,
      NOW,
    );
    const [tag, product, ...links] = mutations;
    expect(tag).toMatchObject({
      table: 'tags',
      row: { name: 'Lácteos', created_at: NOW, updated_at: NOW, deleted_at: null },
    });
    expect(product).toMatchObject({
      table: 'products',
      row: { id: productId, name: 'Leche', brand: 'Lala', display_unit: 'L' },
    });
    expect(links.map((m) => [m.table, m.row.id, m.row.deleted_at])).toEqual([
      ['product_tags', productTagId(productId, 't-basicos'), null],
      ['product_tags', productTagId(productId, String(tag!.row.id)), null],
    ]);
    const variant = variantMutations(
      productId,
      {
        id: null,
        label: '1 L',
        measure: 'volume',
        unitAmount: 1000,
        packCount: 1,
        soldByWeight: false,
        codes: ['7501020515343'],
      },
      null,
      NOW,
    );
    expect(variant.map((m) => m.table)).toEqual(['variants', 'barcodes']);
    expect(variant[1]!.row).toMatchObject({
      variant_id: variant[0]!.row.id,
      code: '7501020515343',
      source: 'manual',
    });
  });

  it('edits only what the form has, later than the row it read, and tombstones what was taken off', () => {
    const { mutations } = productMutations(
      {
        name: 'Leche Entera',
        brand: 'Lala',
        categoryId: 'c-lacteos',
        tagIds: [],
        newTags: [],
        displayUnit: 'L',
        notes: null,
      },
      detail.product,
      NOW,
    );
    expect(mutations).toEqual([
      {
        table: 'products',
        row: {
          id: 'p1',
          updated_at: NOW,
          name: 'Leche Entera',
          brand: 'Lala',
          category_id: 'c-lacteos',
          display_unit: 'L',
          notes: null,
        },
      },
      {
        table: 'product_tags',
        row: {
          id: productTagId('p1', 't-basicos'),
          product_id: 'p1',
          tag_id: 't-basicos',
          created_at: NOW,
          updated_at: NOW,
          deleted_at: NOW,
        },
      },
    ]);
    // A row read in the future (another phone's clock) is still overtaken.
    expect(
      productMutations(
        {
          name: 'x',
          brand: null,
          categoryId: null,
          tagIds: ['t-basicos'],
          newTags: [],
          displayUnit: 'L',
          notes: null,
        },
        { ...detail.product, updated_at: 9_000 },
        NOW,
      ).mutations[0]!.row.updated_at,
    ).toBe(9_001);
    const v = variantMutations(
      'p1',
      {
        id: 'v1',
        label: '1 L',
        measure: 'volume',
        unitAmount: 1000,
        packCount: 1,
        soldByWeight: false,
        codes: ['12345678'],
      },
      detail.variants[0]!,
      NOW,
    );
    expect(v.map((m) => [m.table, m.row.code ?? m.row.id, m.row.deleted_at ?? null])).toEqual([
      ['variants', 'v1', null],
      ['barcodes', '12345678', null],
      ['barcodes', 'b1', NOW],
    ]);
  });

  it('deletes a product with its variants and their codes (04 §6.2)', () => {
    expect(deleteProductMutations(detail, NOW).map((m) => [m.table, m.row.id, m.row.deleted_at])).toEqual([
      ['products', 'p1', NOW],
      ['variants', 'v1', NOW],
      ['barcodes', 'b1', NOW],
      ['variants', 'v2', NOW],
    ]);
  });
});
