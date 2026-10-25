import type { PurchaseDetailResponse } from '@maunedas/shared/api/purchases';
import { affectsPrice } from '@maunedas/shared/pricing/promotions';
import { ILLEGIBLE, normalizeReceiptText } from '@maunedas/shared/receipts/normalize';
import { receiptAliasId } from '@maunedas/shared/util/uuid';
import { type Mutation, newRow, touchedAt } from '../../../lib/sync';
import { encodeParams } from '../../../lib/promotions';
import { amountsOf, type PurchaseDraft } from './draft';

const tombstone = (row: { id: string; updated_at: number }, now: number) => ({
  id: row.id,
  updated_at: touchedAt(row.updated_at, now),
  deleted_at: now,
});

/**
 * The rows a save writes (04 §7), as Android's `PurchaseEditor.save`: the purchase, its lines numbered in order
 * (`final = gross − discount`), one promotion per discounted line and one per ticket discount; lines and promotions
 * that are gone become tombstones (04 §6.2). New rows carry every column; changes carry what the editor owns, later
 * than the row read. [confirm] makes it confirmed; otherwise it keeps its status. A confirmed ticket line with a
 * variant teaches its store that text (09 §7.4).
 */
export function purchaseMutations(
  draft: PurchaseDraft,
  existing: PurchaseDetailResponse | null,
  confirm: boolean,
  now = Date.now(),
): { purchaseId: string; mutations: Mutation[] } {
  const storeId = draft.storeId;
  if (!storeId) throw new Error('Una compra necesita tienda');
  const status = confirm || draft.confirmed ? 'confirmed' : 'draft';
  const fields = {
    store_id: storeId,
    branch_id: draft.branchId,
    purchased_at: draft.purchasedAt,
    discount_cents: draft.ticketDiscounts.reduce((sum, d) => sum + d.amountCents, 0),
    total_cents: draft.ticketTotalCents,
    status,
    notes: draft.notes,
  };
  const purchase = existing
    ? { id: existing.purchase.id, updated_at: touchedAt(existing.purchase.updated_at, now), ...fields }
    : newRow({ ...fields, currency: 'MXN', source: draft.source }, now);

  const items = new Map((existing?.items ?? []).map((i) => [i.id, i]));
  const promos = existing?.promotions ?? [];
  const lines = draft.lines.map((line, i) => {
    const a = amountsOf(line);
    const cols = {
      line_no: i + 1,
      variant_id: line.variant?.id ?? null,
      raw_text: line.rawText,
      quantity: line.quantity,
      unit_price_cents: line.unitPriceCents,
      gross_cents: a.gross_cents,
      discount_cents: a.discount_cents,
      final_cents: a.final_cents,
    };
    const current = line.id ? items.get(line.id) : undefined;
    return current
      ? { id: current.id, updated_at: touchedAt(current.updated_at, now), ...cols }
      : newRow({ purchase_id: purchase.id, ...cols }, now);
  });

  const kept = new Set<string>();
  const promoRows = [
    ...draft.lines.flatMap((line, i) => {
      const promo = line.promotion;
      if (!promo) return [];
      const row = lines[i]!;
      const cols = {
        type: promo.type,
        params: encodeParams(promo.params),
        description: promo.description,
        discount_cents: amountsOf(line).discount_cents,
        affects_price: affectsPrice(promo.type) ? 1 : 0,
      };
      const current = promos.find((p) => p.purchase_item_id === row.id);
      if (current) kept.add(current.id);
      return [
        current
          ? { id: current.id, updated_at: touchedAt(current.updated_at, now), ...cols }
          : newRow({ purchase_id: null, purchase_item_id: row.id, observation_id: null, ...cols }, now),
      ];
    }),
    ...draft.ticketDiscounts.map((d) => {
      const cols = { description: d.description, discount_cents: d.amountCents };
      const current = d.id ? promos.find((p) => p.id === d.id && p.purchase_id === purchase.id) : undefined;
      if (current) kept.add(current.id);
      return current
        ? { id: current.id, updated_at: touchedAt(current.updated_at, now), ...cols }
        : newRow(
            {
              purchase_id: purchase.id,
              purchase_item_id: null,
              observation_id: null,
              type: 'coupon',
              params: null,
              affects_price: 1,
              ...cols,
            },
            now,
          );
    }),
  ];
  const liveIds = new Set(lines.map((l) => l.id));

  const aliases = new Map<string, Mutation>();
  if (status === 'confirmed') {
    for (const line of draft.lines) {
      const norm = line.rawText ? normalizeReceiptText(line.rawText) : '';
      if (!line.variant || norm === '' || norm === ILLEGIBLE) continue;
      const id = receiptAliasId(storeId, norm);
      aliases.set(id, {
        table: 'receipt_aliases',
        row: {
          id,
          store_id: storeId,
          raw_text_norm: norm,
          variant_id: line.variant.id,
          created_at: now,
          updated_at: now,
          deleted_at: null,
        },
      });
    }
  }

  return {
    purchaseId: purchase.id,
    mutations: [
      { table: 'purchases', row: purchase },
      ...lines.map((row) => ({ table: 'purchase_items', row })),
      ...promoRows.map((row) => ({ table: 'promotions', row })),
      // A removed line takes its promotion with it (04 §6.2).
      ...promos.filter((p) => !kept.has(p.id)).map((p) => ({ table: 'promotions', row: tombstone(p, now) })),
      ...[...items.values()]
        .filter((i) => !liveIds.has(i.id))
        .map((i) => ({ table: 'purchase_items', row: tombstone(i, now) })),
      ...aliases.values(),
    ],
  };
}

/**
 * RF-COM-08: anyone may; its lines, promotions and receipt pages go too (04 §6.2). The pages' rows are written only by
 * clients, so a tombstone at [now] is later than them.
 */
export function deletePurchaseMutations(detail: PurchaseDetailResponse, now = Date.now()): Mutation[] {
  return [
    { table: 'purchases', row: tombstone(detail.purchase, now) },
    ...detail.items.map((i) => ({ table: 'purchase_items', row: tombstone(i, now) })),
    ...detail.promotions.map((p) => ({ table: 'promotions', row: tombstone(p, now) })),
    ...detail.receipt_images.map((img) => ({
      table: 'images',
      row: { id: img.image_id, updated_at: now, deleted_at: now },
    })),
  ];
}
