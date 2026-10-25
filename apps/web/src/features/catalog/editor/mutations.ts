import type { ProductDetailResponse, ProductDetailVariant } from '@maunedas/shared/api/catalog';
import { productTagId } from '@maunedas/shared/util/uuid';
import { type Mutation, newRow, touchedAt } from '../../../lib/sync';
import type { ProductDraft } from './productForm';
import type { VariantDraft } from './variantForm';

/**
 * The rows a save writes (04 §7), parents first. New rows carry every column; changes carry what the form edits, so
 * the server keeps the rest (04 §3.3); removals are tombstones. `product_tags` ids are UUIDv5 of product and tag
 * (CLAUDE.md rule 3), so a tag taken off and put back is the same row.
 */
export function productMutations(
  draft: ProductDraft,
  existing: ProductDetailResponse['product'] | null,
  now = Date.now(),
): { productId: string; mutations: Mutation[] } {
  const tags = draft.newTags.map((name) => newRow({ name }, now));
  const tagIds = [...draft.tagIds, ...tags.map((t) => t.id)];
  const fields = {
    name: draft.name,
    brand: draft.brand,
    category_id: draft.categoryId,
    display_unit: draft.displayUnit,
    notes: draft.notes,
  };
  const product = existing
    ? { id: existing.id, updated_at: touchedAt(existing.updated_at, now), ...fields }
    : newRow(fields, now);
  const before = new Set(existing?.tags.map((t) => t.id) ?? []);
  const productTag = (tagId: string, deleted: boolean) => ({
    id: productTagId(product.id, tagId),
    product_id: product.id,
    tag_id: tagId,
    created_at: now,
    updated_at: now,
    deleted_at: deleted ? now : null,
  });
  return {
    productId: product.id,
    mutations: [
      ...tags.map((row) => ({ table: 'tags', row })),
      { table: 'products', row: product },
      ...tagIds
        .filter((t) => !before.has(t))
        .map((t) => ({ table: 'product_tags', row: productTag(t, false) })),
      ...[...before]
        .filter((t) => !tagIds.includes(t))
        .map((t) => ({ table: 'product_tags', row: productTag(t, true) })),
    ],
  };
}

/** A variant and the codes added to it or taken off it. */
export function variantMutations(
  productId: string,
  draft: VariantDraft,
  existing: ProductDetailVariant | null,
  now = Date.now(),
): Mutation[] {
  const fields = {
    product_id: productId,
    label: draft.label,
    measure: draft.measure,
    unit_amount: draft.unitAmount,
    pack_count: draft.packCount,
    sold_by_weight: draft.soldByWeight ? 1 : 0,
  };
  const variant = existing
    ? { id: existing.id, updated_at: touchedAt(existing.updated_at, now), ...fields }
    : newRow(fields, now);
  const rows = existing?.barcode_rows ?? [];
  return [
    { table: 'variants', row: variant },
    ...draft.codes
      .filter((c) => !rows.some((r) => r.code === c))
      .map((code) => ({
        table: 'barcodes',
        row: newRow({ variant_id: variant.id, code, source: 'manual' }, now),
      })),
    ...rows
      .filter((r) => !draft.codes.includes(r.code))
      .map((r) => ({
        table: 'barcodes',
        row: { id: r.id, updated_at: touchedAt(r.updated_at, now), deleted_at: now },
      })),
  ];
}

/** Admin only (RF-CAT-08): the variant and its codes (04 §6.2). */
export function deleteVariantMutations(v: ProductDetailVariant, now = Date.now()): Mutation[] {
  return [
    { table: 'variants', row: { id: v.id, updated_at: touchedAt(v.updated_at, now), deleted_at: now } },
    ...v.barcode_rows.map((r) => ({
      table: 'barcodes',
      row: { id: r.id, updated_at: touchedAt(r.updated_at, now), deleted_at: now },
    })),
  ];
}

/** Admin only: the product, its variants and their codes; purchases and prices stay (04 §6.2). */
export function deleteProductMutations(page: ProductDetailResponse, now = Date.now()): Mutation[] {
  return [
    {
      table: 'products',
      row: { id: page.product.id, updated_at: touchedAt(page.product.updated_at, now), deleted_at: now },
    },
    ...page.variants.flatMap((v) => deleteVariantMutations(v, now)),
  ];
}
