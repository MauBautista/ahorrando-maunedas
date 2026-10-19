import { env } from 'cloudflare:workers';
import { uuidv7 } from '@maunedas/shared/util/uuid';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { verifySigned } from '../src/images/signing';
import {
  edit,
  image,
  item,
  product,
  purchase,
  store,
  syncHarness,
  t,
  variant,
  type Mutation,
} from './support/sync';

let h: Awaited<ReturnType<typeof syncHarness>>;
const DAY = 86_400_000;
const now = Date.now();

beforeAll(async () => {
  h = await syncHarness();
});

async function push(mutations: Mutation[], as: 'admin' | 'member' = 'member') {
  const res = await h.push(mutations, as);
  const body = await res.json<{ conflicts: unknown[] }>();
  expect(res.status, JSON.stringify(body)).toBe(200);
  expect(body.conflicts).toEqual([]);
}

async function get<T>(path: string): Promise<{ status: number; body: T }> {
  const res = await h.app.request(
    path,
    { headers: { Authorization: `Bearer ${h.tokens.member}` } },
    env as never,
  );
  return { status: res.status, body: await res.json<T>() };
}

const promotion = (
  owner: { purchase_id?: string; purchase_item_id?: string },
  o: Record<string, unknown> = {},
) => {
  const at = t();
  return {
    table: 'promotions',
    row: {
      id: uuidv7(),
      created_at: at,
      updated_at: at,
      purchase_id: owner.purchase_id ?? null,
      purchase_item_id: owner.purchase_item_id ?? null,
      observation_id: null,
      type: 'coupon',
      discount_cents: 500,
      ...o,
    },
  };
};

interface ListBody {
  items: Array<{
    id: string;
    store_id: string;
    purchased_at: number;
    status: string;
    total_cents: number | null;
    lines_total_cents: number;
    lines: number;
    receipt_pages: number;
  }>;
  next_cursor: string | null;
}

interface DetailBody {
  purchase: { id: string; discount_cents: number };
  items: Array<{
    id: string;
    line_no: number;
    raw_text: string | null;
    product_id: string | null;
    product_name: string | null;
    variant_label: string | null;
    display_unit: string | null;
    display_cents: number | null;
    final_cents: number;
  }>;
  promotions: Array<{ id: string; type: string; params: string | null }>;
  receipt_images: Array<{ image_id: string; original_url: string | null; thumb_url: string | null }>;
}

let fx: Record<string, Mutation>;

beforeEach(async () => {
  await h.reset();
  const walmart = store({ name: 'Walmart' });
  const costco = store({ name: 'Costco' });
  const leche = product({ name: 'Leche Lala Entera', display_unit: 'L' });
  const l1 = variant(leche.row.id, { label: '1 L' });
  const cafe = product({ name: 'Café', display_unit: 'kg' });
  const sobres = variant(cafe.row.id, { label: '10 sobres', measure: 'count', unit_amount: 10 });
  await push([walmart, costco, leche, l1, cafe, sobres]);

  // A draft with a $5.00 coupon over $50.00 of lines, 2 receipt pages, one deleted line and a deleted page.
  const draft = purchase(walmart.row.id, { purchased_at: now - DAY, discount_cents: 500, total_cents: 4500 });
  const milk = item(draft.row.id, l1.row.id, { raw_text: 'LCH LALA ENT 1L' });
  const loose = item(draft.row.id, null, {
    line_no: 2,
    raw_text: 'ABARR VARIOS',
    unit_price_cents: 2150,
    gross_cents: 2150,
    final_cents: 2150,
  });
  const coffee = item(draft.row.id, sobres.row.id, {
    line_no: 3,
    unit_price_cents: 5000,
    gross_cents: 5000,
    final_cents: 5000,
  });
  const page1 = image(draft.row.id, { owner_type: 'purchase', role: 'receipt' });
  const page2 = image(draft.row.id, { owner_type: 'purchase', role: 'receipt' });
  const gone = image(draft.row.id, { owner_type: 'purchase', role: 'receipt' });
  const p1 = { ...page1, row: { ...page1.row, original_key: `images/${page1.row.id}/original.jpg` } };
  const confirmed = purchase(costco.row.id, { purchased_at: now - 2 * DAY, status: 'confirmed' });
  const sameTime = purchase(costco.row.id, { purchased_at: now - 2 * DAY, status: 'confirmed' });
  const old = purchase(walmart.row.id, { purchased_at: now - 30 * DAY, status: 'confirmed' });
  const deleted = purchase(walmart.row.id, { purchased_at: now - 3 * DAY });
  await push([
    draft,
    milk,
    loose,
    coffee,
    p1,
    page2,
    gone,
    confirmed,
    sameTime,
    old,
    deleted,
    item(confirmed.row.id, l1.row.id),
    item(old.row.id, l1.row.id),
    promotion(
      { purchase_id: draft.row.id },
      { description: 'CUPON', params: JSON.stringify({ code: 'AHORRA5' }) },
    ),
    promotion({ purchase_item_id: milk.row.id }, { type: 'price_cut', discount_cents: 0 }),
  ]);
  await push([
    edit(coffee, { deleted_at: t() }),
    edit(gone, { deleted_at: t() }),
    edit(deleted, { deleted_at: t() }),
    // A promotion of a deleted line does not show.
    promotion({ purchase_item_id: coffee.row.id }),
  ]);
  fx = {
    walmart,
    costco,
    l1,
    leche,
    sobres,
    draft,
    milk,
    loose,
    coffee,
    page1,
    page2,
    confirmed,
    sameTime,
    old,
  };
});

describe('GET /v1/purchases (03 §7)', () => {
  it('lists live purchases newest first with line totals and receipt pages', async () => {
    const { status, body } = await get<ListBody>('/v1/purchases');
    expect(status).toBe(200);
    const [newer, older] = [fx.confirmed!.row.id, fx.sameTime!.row.id].sort().reverse();
    expect(body.items.map((p) => p.id)).toEqual([fx.draft!.row.id, newer, older, fx.old!.row.id]);
    expect(body.items[0]).toMatchObject({
      store_id: fx.walmart!.row.id,
      status: 'draft',
      total_cents: 4500,
      lines_total_cents: 5000,
      lines: 2,
      receipt_pages: 2,
    });
    expect(body.items.find((p) => p.id === fx.sameTime!.row.id)).toMatchObject({
      lines: 0,
      lines_total_cents: 0,
    });
    expect(body.items.find((p) => p.id === fx.confirmed!.row.id)).toMatchObject({
      lines: 1,
      lines_total_cents: 2850,
      receipt_pages: 0,
      total_cents: null,
    });
    expect(body.next_cursor).toBeNull();
  });

  it('filters by store, status and date range', async () => {
    const ids = async (q: string) => (await get<ListBody>(`/v1/purchases?${q}`)).body.items.map((p) => p.id);
    expect(await ids(`store_id=${fx.walmart!.row.id}`)).toEqual([fx.draft!.row.id, fx.old!.row.id]);
    expect(await ids('status=draft')).toEqual([fx.draft!.row.id]);
    expect(await ids(`from=${now - 2 * DAY}&to=${now - 2 * DAY}`)).toHaveLength(2);
    expect(await ids(`from=${now - 10 * DAY}&status=confirmed&store_id=${fx.costco!.row.id}`)).toHaveLength(
      2,
    );
  });

  it('pages with an opaque cursor, also across purchases at the same time', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: { body: ListBody } = await get<ListBody>(
        `/v1/purchases?limit=1${cursor ? `&cursor=${cursor}` : ''}`,
      );
      seen.push(...page.body.items.map((p) => p.id));
      cursor = page.body.next_cursor;
    } while (cursor);
    expect(seen).toEqual((await get<ListBody>('/v1/purchases')).body.items.map((p) => p.id));
    expect(new Set(seen).size).toBe(4);
  });

  it('validates the query', async () => {
    expect((await get('/v1/purchases?status=paid')).status).toBe(400);
    expect((await get('/v1/purchases?from=10&to=5')).status).toBe(400);
    expect((await get('/v1/purchases?limit=0')).status).toBe(400);
    expect((await get('/v1/purchases?cursor=zzz')).status).toBe(400);
    expect((await get('/v1/purchases?store_id=x')).status).toBe(400);
  });
});

describe('GET /v1/purchases/:id (03 §7)', () => {
  it('returns the purchase with live lines, their product and the prorated price per unit', async () => {
    const { status, body } = await get<DetailBody>(`/v1/purchases/${fx.draft!.row.id}`);
    expect(status).toBe(200);
    expect(body.purchase).toMatchObject({ id: fx.draft!.row.id, discount_cents: 500 });
    expect(body.items.map((i) => i.line_no)).toEqual([1, 2]);
    // $28.50 of $50.00 with a $5.00 coupon: paid 2850 × 0.9 = 2565 per liter, also in a draft.
    expect(body.items[0]).toMatchObject({
      id: fx.milk!.row.id,
      raw_text: 'LCH LALA ENT 1L',
      product_id: fx.leche!.row.id,
      product_name: 'Leche Lala Entera',
      variant_label: '1 L',
      display_unit: 'L',
      display_cents: 2565,
      final_cents: 2850,
    });
    expect(body.items[1]).toMatchObject({
      raw_text: 'ABARR VARIOS',
      product_id: null,
      product_name: null,
      variant_label: null,
      display_unit: null,
      display_cents: null,
    });
    expect(Object.keys(body.items[0]!)).not.toContain('product_display_unit');
  });

  it('a line of another measure is shown in its default unit', async () => {
    const buy = purchase(fx.walmart!.row.id, { status: 'confirmed' });
    await push([
      buy,
      item(buy.row.id, fx.sobres!.row.id, { unit_price_cents: 5000, gross_cents: 5000, final_cents: 5000 }),
    ]);
    const { body } = await get<DetailBody>(`/v1/purchases/${buy.row.id}`);
    expect(body.items[0]).toMatchObject({ display_unit: 'pz', display_cents: 500 });
  });

  it('includes ticket and line promotions, except those of deleted lines', async () => {
    const { body } = await get<DetailBody>(`/v1/purchases/${fx.draft!.row.id}`);
    expect(body.promotions.map((p) => p.type)).toEqual(['coupon', 'price_cut']);
    expect(JSON.parse(body.promotions[0]!.params!)).toEqual({ code: 'AHORRA5' });
  });

  it('includes live receipt pages in order, with signed URLs', async () => {
    const { body } = await get<DetailBody>(`/v1/purchases/${fx.draft!.row.id}`);
    expect(body.receipt_images.map((r) => r.image_id)).toEqual([fx.page1!.row.id, fx.page2!.row.id]);
    const url = new URL(body.receipt_images[0]!.original_url!);
    expect(url.pathname).toBe(`/v1/images/${fx.page1!.row.id}/blobs/original.jpg`);
    expect(
      await verifySigned(
        'test-image-url-secret',
        url.pathname,
        url.searchParams.get('exp')!,
        url.searchParams.get('sig')!,
      ),
    ).toBe(true);
    expect(body.receipt_images[1]).toMatchObject({ original_url: null, thumb_url: null });
  });

  it('unknown or deleted purchase → 404; malformed id → 400', async () => {
    expect((await get(`/v1/purchases/${uuidv7()}`)).status).toBe(404);
    expect((await get('/v1/purchases/abc')).status).toBe(400);
    await push([edit(fx.old!, { deleted_at: t() })]);
    expect((await get(`/v1/purchases/${fx.old!.row.id}`)).status).toBe(404);
  });
});
