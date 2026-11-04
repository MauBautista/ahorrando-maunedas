import { env } from 'cloudflare:workers';
import type { ImportPurchase, ImportResponse } from '@maunedas/shared/api/imports';
import { normalizeReceiptText } from '@maunedas/shared/receipts/normalize';
import { uuidv7 } from '@maunedas/shared/util/uuid';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fingerprint } from '../src/imports/purchases';
import { alias, product, store, syncHarness, variant, type Mutation } from './support/sync';

let h: Awaited<ReturnType<typeof syncHarness>>;
let fx: { soriana: string; walmart: string; variant: string };

beforeAll(async () => {
  h = await syncHarness();
});

async function importIt(purchases: unknown[], fileName = 'compras.csv') {
  const res = await h.app.request(
    '/v1/purchases/import',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Schema': '1',
        Authorization: `Bearer ${h.tokens.member}`,
      },
      body: JSON.stringify({ file_name: fileName, purchases }),
    },
    env as never,
  );
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const AT = Date.UTC(2026, 10, 4, 18);
const purchase = (o: Partial<ImportPurchase> = {}): ImportPurchase => ({
  store_id: fx.soriana,
  purchased_at: AT,
  ticket: null,
  lines: [
    { description: 'LECHE LALA ENTERA 1L', quantity: 2, unit_price_cents: 2_850, final_cents: 5_700 },
    { description: 'Café de grano', quantity: 0.5, unit_price_cents: 20_000, final_cents: 10_000 },
  ],
  ...o,
});

beforeEach(async () => {
  await h.reset();
  const soriana = store({ name: 'Soriana', kind: 'both' });
  const walmart = store({ name: 'Walmart', kind: 'both' });
  const p = product({ name: 'Leche Lala Entera', display_unit: 'L' });
  const v = variant(p.row.id);
  const pushed = await h.push(
    [
      soriana,
      walmart,
      p,
      v,
      alias(soriana.row.id as string, v.row.id as string, normalizeReceiptText('LECHE LALA ENTERA 1L')),
    ] as Mutation[],
    'admin',
  );
  expect(pushed.status).toBe(200);
  fx = { soriana: soriana.row.id as string, walmart: walmart.row.id as string, variant: v.row.id as string };
});

describe('POST /v1/purchases/import (T-306, 03 §15)', () => {
  it('makes draft purchases with their lines linked by the store aliases, under one new version', async () => {
    const before = Number(
      await env.DB.prepare(`SELECT value FROM sync_meta WHERE key = 'version'`).first('value'),
    );
    const res = await importIt([
      purchase(),
      purchase({ store_id: fx.walmart, ticket: 'A-17', lines: [purchase().lines[0]!] }),
    ]);
    expect(res.status).toBe(200);
    const [first, second] = (res.body as ImportResponse).results;
    expect([first!.status, first!.lines, first!.linked]).toEqual(['created', 2, 1]);
    // The alias is Soriana's: Walmart's line stays unlinked.
    expect([second!.status, second!.lines, second!.linked]).toEqual(['created', 1, 0]);

    const rows = await env.DB.prepare(
      `SELECT store_id, purchased_at, currency, subtotal_cents, discount_cents, total_cents, source, status, notes,
              version, updated_by
       FROM purchases WHERE id IN (?1, ?2) ORDER BY total_cents DESC`,
    )
      .bind(first!.purchase_id, second!.purchase_id)
      .all();
    expect(rows.results).toEqual([
      {
        store_id: fx.soriana,
        purchased_at: AT,
        currency: 'MXN',
        subtotal_cents: 15_700,
        discount_cents: 0,
        total_cents: 15_700,
        source: 'import',
        status: 'draft',
        notes: 'Importado de compras.csv',
        version: before + 1,
        updated_by: expect.any(String),
      },
      expect.objectContaining({
        store_id: fx.walmart,
        total_cents: 5_700,
        notes: 'Importado de compras.csv · folio A-17',
      }),
    ]);
    const lines = await env.DB.prepare(
      `SELECT line_no, variant_id, raw_text, quantity, unit_price_cents, gross_cents, discount_cents, final_cents,
              typeof(quantity) AS q, version
       FROM purchase_items WHERE purchase_id = ?1 ORDER BY line_no`,
    )
      .bind(first!.purchase_id)
      .all();
    expect(lines.results).toEqual([
      {
        line_no: 1,
        variant_id: fx.variant,
        raw_text: 'LECHE LALA ENTERA 1L',
        quantity: 2,
        unit_price_cents: 2_850,
        gross_cents: 5_700,
        discount_cents: 0,
        final_cents: 5_700,
        q: 'real',
        version: before + 1,
      },
      {
        line_no: 2,
        variant_id: null,
        raw_text: 'Café de grano',
        quantity: 0.5,
        unit_price_cents: 20_000,
        gross_cents: 10_000,
        discount_cents: 0,
        final_cents: 10_000,
        q: 'real',
        version: before + 1,
      },
    ]);
    expect(
      (
        await env.DB.prepare(
          'SELECT fingerprint, file_name FROM purchase_imports ORDER BY created_at, id',
        ).all()
      ).results,
    ).toHaveLength(2);
    // The household gets them by sync.
    const pulled = await (
      await h.pull({ cursors: {} }, 'member')
    ).json<{
      changes: Record<string, Array<{ id: string }>>;
    }>();
    expect(pulled.changes.purchases!.map((p) => p.id)).toEqual(
      expect.arrayContaining([first!.purchase_id, second!.purchase_id]),
    );
    expect(pulled.changes.purchase_items).toHaveLength(3);
  });

  it('the same file again repeats nothing while its purchases live', async () => {
    const first = (await importIt([purchase()])).body as ImportResponse;
    const version = Number(
      await env.DB.prepare(`SELECT value FROM sync_meta WHERE key = 'version'`).first('value'),
    );
    // Same lines with other spaces and case are the same purchase; a repeat in the same request too.
    const sameText = purchase({
      lines: purchase().lines.map((l, i) => (i === 0 ? { ...l, description: 'leche  lala entera 1l' } : l)),
    });
    const other = purchase({ purchased_at: AT + 1 });
    const again = (await importIt([sameText, other, other])).body as ImportResponse;
    expect(again.results.map((r) => r.status)).toEqual(['duplicate', 'created', 'duplicate']);
    expect(again.results[0]).toEqual({
      purchase_id: first.results[0]!.purchase_id,
      status: 'duplicate',
      lines: 2,
      linked: 0,
    });
    expect(again.results[2]!.purchase_id).toBe(again.results[1]!.purchase_id);
    expect(Number(await env.DB.prepare('SELECT count(*) AS n FROM purchases').first('n'))).toBe(2);
    // Nothing new: no new version either.
    const onlyDuplicates = (await importIt([sameText])).body as ImportResponse;
    expect(onlyDuplicates.results[0]!.status).toBe('duplicate');
    expect(
      Number(await env.DB.prepare(`SELECT value FROM sync_meta WHERE key = 'version'`).first('value')),
    ).toBe(version + 1);

    // Deleted, it can come in again.
    const later = Date.now() + 1000;
    const id = first.results[0]!.purchase_id;
    expect(
      (await h.push([{ table: 'purchases', row: { id, updated_at: later, deleted_at: later } }], 'member'))
        .status,
    ).toBe(200);
    expect(((await importIt([purchase()])).body as ImportResponse).results[0]!.status).toBe('created');
  });

  it('a fingerprint is the store, time, folio and lines as paid', async () => {
    const base = await fingerprint(purchase());
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    for (const changed of [
      purchase({ store_id: fx.walmart }),
      purchase({ purchased_at: AT + 1 }),
      purchase({ ticket: '1' }),
      purchase({ lines: [...purchase().lines].reverse() }),
      purchase({ lines: [{ ...purchase().lines[0]!, quantity: 3 }, purchase().lines[1]!] }),
      purchase({ lines: [{ ...purchase().lines[0]!, unit_price_cents: 2_851 }, purchase().lines[1]!] }),
      purchase({ lines: [{ ...purchase().lines[0]!, final_cents: 5_701 }, purchase().lines[1]!] }),
      purchase({
        lines: [{ ...purchase().lines[0]!, description: 'Leche Lala Light' }, purchase().lines[1]!],
      }),
    ]) {
      expect(await fingerprint(changed)).not.toBe(base);
    }
  });

  it('checks the stores and the request', async () => {
    expect((await importIt([purchase({ store_id: uuidv7() })])).status).toBe(404);
    expect(Number(await env.DB.prepare('SELECT count(*) AS n FROM purchases').first('n'))).toBe(0);
    const bad = async (purchases: unknown[], fileName?: string) =>
      (await importIt(purchases, fileName)).status;
    expect(await bad([])).toBe(400);
    expect(await bad(Array.from({ length: 21 }, () => purchase()))).toBe(400);
    expect(await bad([purchase({ lines: [] })])).toBe(400);
    expect(await bad([purchase({ lines: Array.from({ length: 301 }, () => purchase().lines[0]!) })])).toBe(
      400,
    );
    expect(await bad([purchase({ lines: [{ ...purchase().lines[0]!, quantity: 0 }] })])).toBe(400);
    expect(await bad([purchase({ lines: [{ ...purchase().lines[0]!, final_cents: -1 }] })])).toBe(400);
    expect(await bad([purchase({ lines: [{ ...purchase().lines[0]!, unit_price_cents: 1.5 }] })])).toBe(400);
    expect(await bad([purchase({ lines: [{ ...purchase().lines[0]!, description: '  ' }] })])).toBe(400);
    expect(await bad([{ ...purchase(), extra: 1 }])).toBe(400);
    expect(await bad([purchase()], ' ')).toBe(400);
    const anonymous = await h.app.request(
      '/v1/purchases/import',
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Client-Schema': '1' }, body: '{}' },
      env as never,
    );
    expect(anonymous.status).toBe(401);
  });
});
