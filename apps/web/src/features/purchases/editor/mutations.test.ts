import { receiptAliasId } from '@maunedas/shared/util/uuid';
import { describe, expect, it } from 'vitest';
import { purchase } from '../../../test/purchases';
import { draftOf, emptyDraft } from './draft';
import { deletePurchaseMutations, purchaseMutations } from './mutations';

const NOW = 5_000;
const rows = (m: Array<{ table: string; row: Record<string, unknown> }>, table: string) =>
  m.filter((x) => x.table === table).map((x) => x.row);

describe('push rows of the purchase editor (PurchaseEditor.save)', () => {
  it('creates a purchase with its numbered lines, their promotion and the ticket discount', () => {
    const [two, , kilos] = draftOf(purchase).lines;
    const draft = {
      ...emptyDraft(NOW),
      storeId: 's-costco',
      lines: [
        { ...two!, id: null, promotion: { ...two!.promotion!, id: null } },
        { ...kilos!, id: null },
      ],
      ticketDiscounts: [{ id: null, description: 'Cupón', amountCents: 500 }],
      ticketTotalCents: 5100,
    };
    const { purchaseId, mutations } = purchaseMutations(draft, null, false, NOW);
    expect(mutations.map((m) => m.table)).toEqual([
      'purchases',
      'purchase_items',
      'purchase_items',
      'promotions',
      'promotions',
    ]);
    expect(rows(mutations, 'purchases')[0]).toMatchObject({
      id: purchaseId,
      store_id: 's-costco',
      branch_id: null,
      currency: 'MXN',
      source: 'manual',
      status: 'draft',
      discount_cents: 500,
      total_cents: 5100,
      created_at: NOW,
      deleted_at: null,
    });
    const [a, b] = rows(mutations, 'purchase_items');
    expect(a).toMatchObject({
      purchase_id: purchaseId,
      line_no: 1,
      variant_id: 'v1',
      quantity: 2,
      unit_price_cents: 2850,
      gross_cents: 5700,
      discount_cents: 2850,
      final_cents: 2850,
    });
    expect(b).toMatchObject({ line_no: 2, quantity: 0.845, gross_cents: 2780, final_cents: 2780 });
    const [promo, coupon] = rows(mutations, 'promotions');
    expect(promo).toMatchObject({
      purchase_id: null,
      purchase_item_id: a!.id,
      type: 'nxm',
      params: '{"n":2,"m":1}',
      discount_cents: 2850,
      affects_price: 1,
    });
    expect(coupon).toMatchObject({
      purchase_id: purchaseId,
      purchase_item_id: null,
      type: 'coupon',
      description: 'Cupón',
      discount_cents: 500,
    });
    expect(() => purchaseMutations({ ...draft, storeId: null }, null, false, NOW)).toThrow();
  });

  it('edits in place later than what it read, and tombstones lines and promotions that are gone', () => {
    const d = draftOf(purchase);
    // The milk without its 2x1, the unlinked line taken off and no coupon.
    const draft = { ...d, lines: [{ ...d.lines[0]!, promotion: null }, d.lines[2]!], ticketDiscounts: [] };
    const { mutations } = purchaseMutations(
      draft,
      { ...purchase, purchase: { ...purchase.purchase, updated_at: 9_000 } },
      false,
      NOW,
    );
    expect(mutations.map((m) => [m.table, m.row.id, m.row.deleted_at ?? null])).toEqual([
      ['purchases', 'pu1', null],
      ['purchase_items', 'i1', null],
      ['purchase_items', 'i3', null],
      ['promotions', 'pr1', NOW],
      ['promotions', 'pr2', NOW],
      ['purchase_items', 'i2', NOW],
    ]);
    expect(mutations[0]!.row).toMatchObject({ updated_at: 9_001, discount_cents: 0, status: 'draft' });
    expect(mutations[0]!.row).not.toHaveProperty('source');
    expect(mutations[1]!.row).toEqual({
      id: 'i1',
      updated_at: NOW,
      line_no: 1,
      variant_id: 'v1',
      raw_text: 'LCH LALA ENT 1L',
      quantity: 2,
      unit_price_cents: 2850,
      gross_cents: 5700,
      discount_cents: 0,
      final_cents: 5700,
    });
    expect(mutations[2]!.row.line_no).toBe(2);
  });

  it('keeps the promotions it still has, and a confirmed ticket line teaches its store the text', () => {
    const d = draftOf(purchase);
    const { mutations } = purchaseMutations(
      { ...d, lines: [...d.lines, { ...d.lines[0]!, id: null, rawText: 'ILEGIBLE', promotion: null }] },
      purchase,
      true,
      NOW,
    );
    expect(rows(mutations, 'purchases')[0]!.status).toBe('confirmed');
    expect(rows(mutations, 'promotions').map((p) => [p.id, p.deleted_at ?? null])).toEqual([
      ['pr1', null],
      ['pr2', null],
    ]);
    // The unlinked line teaches nothing, nor an unreadable one.
    expect(rows(mutations, 'receipt_aliases')).toEqual([
      {
        id: receiptAliasId('s-costco', 'LCH LALA ENT 1L'),
        store_id: 's-costco',
        raw_text_norm: 'LCH LALA ENT 1L',
        variant_id: 'v1',
        created_at: NOW,
        updated_at: NOW,
        deleted_at: null,
      },
    ]);
    expect(rows(purchaseMutations(d, purchase, false, NOW).mutations, 'receipt_aliases')).toEqual([]);
  });

  it('deletes a purchase with its lines, promotions and ticket pages (04 §6.2)', () => {
    expect(deletePurchaseMutations(purchase, NOW).map((m) => [m.table, m.row.id, m.row.deleted_at])).toEqual([
      ['purchases', 'pu1', NOW],
      ['purchase_items', 'i1', NOW],
      ['purchase_items', 'i2', NOW],
      ['purchase_items', 'i3', NOW],
      ['promotions', 'pr1', NOW],
      ['promotions', 'pr2', NOW],
      ['images', 'img1', NOW],
    ]);
  });
});
