import { env } from 'cloudflare:workers';
import { roundHalfUp } from '@maunedas/shared/pricing/rounding';
import {
  BASE_PER_DISPLAY,
  defaultDisplayUnit,
  type DisplayUnit,
  type Measure,
} from '@maunedas/shared/pricing/units';
import { uuidv7 } from '@maunedas/shared/util/uuid';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  item,
  observation,
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

interface Variante {
  measure: Measure;
  unit_amount: number;
  pack_count: number;
  sold_by_weight?: boolean;
}
interface Fixture {
  casos: Array<{
    nombre: string;
    variante: Variante;
    paid_cents: number;
    quantity: number;
    esperado: { cents_per_base: number; display: Partial<Record<DisplayUnit, number>> };
  }>;
  prorrateo_ticket: {
    casos: Array<{
      nombre: string;
      discount_cents: number;
      lineas: Array<{
        variante: Variante;
        quantity: number;
        final_cents: number;
        esperado: { paid_cents: number; effective_unit_cents: number; cents_per_base: number };
      }>;
    }>;
    tolerancia: number;
  };
  tolerancia_cents_per_base: number;
}
const fixture = env.NORMALIZATION_FIXTURE as Fixture;

beforeAll(async () => {
  h = await syncHarness();
});

async function push(mutations: Mutation[], as: 'admin' | 'member' = 'member') {
  const res = await h.push(mutations, as);
  const body = await res.json<{ conflicts: unknown[]; error?: unknown }>();
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

interface HistoryBody {
  variant: { id: string; product_name: string; label: string };
  display_unit: DisplayUnit;
  points: Array<{
    source: string;
    point_id: string;
    store_id: string;
    observed_at: number;
    list_unit_cents: number;
    effective_unit_cents: number;
    display_cents: number;
    has_promo: boolean;
    listing_id: string | null;
  }>;
  web_confirmed_until: Record<string, number>;
}

/** A product whose single variant has the fixture's measure, shown in `unit`. */
function catalogFor(v: Variante, unit: DisplayUnit, name: string) {
  const p = product({ name, display_unit: unit });
  const sold = v.sold_by_weight ? { sold_by_weight: 1 } : {};
  const vr = variant(p.row.id, {
    label: name,
    measure: v.measure,
    unit_amount: v.unit_amount,
    pack_count: v.pack_count,
    ...sold,
  });
  return { p, v: vr };
}

const line = (purchaseId: string, variantId: string, lineNo: number, finalCents: number, quantity: number) =>
  item(purchaseId, variantId, {
    line_no: lineNo,
    quantity,
    unit_price_cents: roundHalfUp(finalCents / quantity),
    gross_cents: finalCents,
    discount_cents: 0,
    final_cents: finalCents,
  });

beforeEach(async () => {
  await h.reset();
});

describe('v_price_points against fixtures/normalizacion.json', () => {
  it('ticket discount prorating (prorrateo_ticket) matches in D1 and through the history', async () => {
    const shop = store({ name: 'Walmart' });
    const catalog: Mutation[] = [shop];
    const sales: Mutation[] = [];
    const expected: Array<{
      itemId: string;
      variantId: string;
      unit: DisplayUnit;
      e: Fixture['prorrateo_ticket']['casos'][number]['lineas'][number]['esperado'];
      measure: Measure;
    }> = [];
    for (const caso of fixture.prorrateo_ticket.casos) {
      const buy = purchase(shop.row.id, {
        status: 'confirmed',
        discount_cents: caso.discount_cents,
        purchased_at: Date.now() - DAY,
      });
      sales.push(buy);
      caso.lineas.forEach((l, i) => {
        const unit = defaultDisplayUnit(l.variante.measure);
        const { p, v } = catalogFor(l.variante, unit, `${caso.nombre} ${i + 1}`);
        catalog.push(p, v);
        const it = line(buy.row.id, v.row.id, i + 1, l.final_cents, l.quantity);
        sales.push(it);
        expected.push({
          itemId: it.row.id,
          variantId: v.row.id,
          unit,
          e: l.esperado,
          measure: l.variante.measure,
        });
      });
    }
    await push(catalog);
    await push(sales);

    const { results } = await env.DB.prepare(
      'SELECT point_id, effective_unit_cents, cents_per_base FROM v_price_points WHERE source = ?1',
    )
      .bind('purchase')
      .all<{ point_id: string; effective_unit_cents: number; cents_per_base: number }>();
    expect(results).toHaveLength(expected.length);
    for (const x of expected) {
      const row = results.find((r) => r.point_id === x.itemId)!;
      expect(row.effective_unit_cents).toBe(x.e.effective_unit_cents);
      expect(Math.abs(row.cents_per_base - x.e.cents_per_base)).toBeLessThanOrEqual(
        fixture.prorrateo_ticket.tolerancia,
      );

      const { body } = await get<HistoryBody>(`/v1/variants/${x.variantId}/history`);
      expect(body.points).toHaveLength(1);
      expect(body.points[0]).toMatchObject({
        effective_unit_cents: x.e.effective_unit_cents,
        display_cents: roundHalfUp(x.e.cents_per_base * BASE_PER_DISPLAY[x.unit].base),
      });
    }
  });

  it('price normalization (casos) shows the expected price in every display unit', async () => {
    const shop = store({ name: 'Costco' });
    const catalog: Mutation[] = [shop];
    const sales: Mutation[] = [];
    const expected: Array<{ variantId: string; display: number; nombre: string }> = [];
    for (const caso of fixture.casos) {
      for (const [unit, display] of Object.entries(caso.esperado.display) as Array<[DisplayUnit, number]>) {
        const { p, v } = catalogFor(caso.variante, unit, `${caso.nombre} (${unit})`);
        const buy = purchase(shop.row.id, { status: 'confirmed', purchased_at: Date.now() - DAY });
        catalog.push(p, v);
        sales.push(buy, line(buy.row.id, v.row.id, 1, caso.paid_cents, caso.quantity));
        expected.push({ variantId: v.row.id, display, nombre: caso.nombre });
      }
    }
    await push(catalog);
    await push(sales);
    for (const x of expected) {
      const { body } = await get<HistoryBody>(`/v1/variants/${x.variantId}/history`);
      expect(body.points[0]?.display_cents, x.nombre).toBe(x.display);
    }
  });
});

describe('GET /v1/variants/:id/history (03 §7)', () => {
  let fx: Record<string, Mutation>;
  let listingId: string;
  const now = Date.now();

  beforeEach(async () => {
    const walmart = store({ name: 'Walmart', kind: 'both' });
    const amazon = store({ name: 'Amazon', kind: 'online' });
    const leche = product({ name: 'Leche Lala Entera', display_unit: 'L' });
    const l1 = variant(leche.row.id, { label: '1 L' });
    const cafe = product({ name: 'Café', display_unit: 'kg' });
    const sobres = variant(cafe.row.id, { label: '10 sobres', measure: 'count', unit_amount: 10 });
    await push([walmart, amazon, leche, l1, cafe, sobres]);

    const old = purchase(walmart.row.id, { status: 'confirmed', purchased_at: now - 400 * DAY });
    const recent = purchase(walmart.row.id, {
      status: 'confirmed',
      purchased_at: now - 300 * DAY,
      discount_cents: 500,
    });
    const draft = purchase(walmart.row.id, { purchased_at: now - 10 * DAY });
    const promo = purchase(walmart.row.id, { status: 'confirmed', purchased_at: now - 5 * DAY });
    const coffee = purchase(walmart.row.id, { status: 'confirmed', purchased_at: now - 5 * DAY });
    await push([
      old,
      recent,
      draft,
      promo,
      coffee,
      item(old.row.id, l1.row.id),
      // $28.50 + $21.50 with a $5.00 coupon: this line paid 2850 × (1 − 500/5000) = 2565.
      item(recent.row.id, l1.row.id),
      item(recent.row.id, null, { line_no: 2, unit_price_cents: 2150, gross_cents: 2150, final_cents: 2150 }),
      item(draft.row.id, l1.row.id, { unit_price_cents: 100, gross_cents: 100, final_cents: 100 }),
      item(promo.row.id, l1.row.id, {
        quantity: 2,
        gross_cents: 5700,
        discount_cents: 2850,
        final_cents: 2850,
      }),
      item(coffee.row.id, sobres.row.id, { unit_price_cents: 5000, gross_cents: 5000, final_cents: 5000 }),
      observation(l1.row.id, walmart.row.id, {
        price_cents: 2700,
        observed_at: now - 3 * DAY,
        promo_text: '2x$50',
      }),
    ]);

    listingId = uuidv7();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO listings (id, variant_id, store_id, adapter, url, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'amazon_mx', 'https://www.amazon.com.mx/dp/B000000001', ?4, ?4)`,
      ).bind(listingId, l1.row.id, amazon.row.id, now - 30 * DAY),
      env.DB.prepare(
        `INSERT INTO price_observations (id, variant_id, store_id, listing_id, source, price_cents, observed_at, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, 'web', 2600, ?5, ?5, ?5)`,
      ).bind(uuidv7(), l1.row.id, amazon.row.id, listingId, now - 2 * DAY),
      env.DB.prepare(
        'INSERT INTO listing_state (listing_id, last_checked_at, updated_at) VALUES (?1, ?2, ?2)',
      ).bind(listingId, now - DAY),
    ]);
    fx = { walmart, amazon, leche, l1, cafe, sobres };
  });

  it('defaults to the last 365 days, oldest first, confirmed purchases only, with the coupon prorated', async () => {
    const { status, body } = await get<HistoryBody>(`/v1/variants/${fx.l1!.row.id}/history`);
    expect(status).toBe(200);
    expect(body.variant).toMatchObject({
      id: fx.l1!.row.id,
      label: '1 L',
      product_name: 'Leche Lala Entera',
    });
    expect(body.display_unit).toBe('L');
    expect(
      body.points.map((p) => [
        p.source,
        p.list_unit_cents,
        p.effective_unit_cents,
        p.display_cents,
        p.has_promo,
      ]),
    ).toEqual([
      ['purchase', 2850, 2565, 2565, true],
      ['purchase', 2850, 1425, 1425, true],
      ['shelf', 2700, 2700, 2700, true],
      ['web', 2600, 2600, 2600, false],
    ]);
    expect(body.web_confirmed_until).toEqual({ [listingId]: now - DAY });
    expect(body.points[3]?.listing_id).toBe(listingId);
  });

  it('filters by range, sources and store', async () => {
    const all = await get<HistoryBody>(`/v1/variants/${fx.l1!.row.id}/history?from=0`);
    expect(all.body.points).toHaveLength(5);
    const range = await get<HistoryBody>(
      `/v1/variants/${fx.l1!.row.id}/history?from=${now - 4 * DAY}&to=${now - 2 * DAY}`,
    );
    expect(range.body.points.map((p) => p.source)).toEqual(['shelf', 'web']);
    const shelf = await get<HistoryBody>(`/v1/variants/${fx.l1!.row.id}/history?sources=shelf,web`);
    expect(shelf.body.points.map((p) => p.source)).toEqual(['shelf', 'web']);
    const walmart = await get<HistoryBody>(
      `/v1/variants/${fx.l1!.row.id}/history?store_id=${fx.walmart!.row.id}`,
    );
    expect(walmart.body.points.map((p) => p.source)).toEqual(['purchase', 'purchase', 'shelf']);
    expect(walmart.body.web_confirmed_until).toEqual({});
  });

  it('a variant of another measure is shown in its default unit', async () => {
    const { body } = await get<HistoryBody>(`/v1/variants/${fx.sobres!.row.id}/history`);
    expect(body.display_unit).toBe('pz');
    expect(body.points[0]?.display_cents).toBe(500);
  });

  it('validates the query and answers 404 for unknown or deleted variants', async () => {
    const path = `/v1/variants/${fx.l1!.row.id}/history`;
    expect((await get(`${path}?sources=shelf,ticket`)).status).toBe(400);
    expect((await get(`${path}?sources=`)).status).toBe(400);
    expect((await get(`${path}?from=10&to=5`)).status).toBe(400);
    expect((await get(`${path}?store_id=x`)).status).toBe(400);
    expect((await get(`/v1/variants/${uuidv7()}/history`)).status).toBe(404);
    expect((await get('/v1/variants/abc/history')).status).toBe(400);
    await push([{ ...fx.l1!, row: { ...fx.l1!.row, updated_at: t(), deleted_at: t() } }], 'admin');
    expect((await get(path)).status).toBe(404);
  });
});

describe('GET /v1/products/:id/compare (03 §7)', () => {
  interface CompareBody {
    display_unit: DisplayUnit;
    rows: Array<{
      variant_id: string;
      store_id: string;
      display_unit: DisplayUnit;
      last: { display_cents: number; observed_at: number; source: string };
      min: { display_cents: number; observed_at: number };
      avg_display_cents: number;
      n: number;
    }>;
    best: { variant_id: string; store_id: string } | null;
  }
  let fx: Record<string, Mutation>;
  const now = Date.now();

  beforeEach(async () => {
    const costco = store({ name: 'Costco' });
    const walmart = store({ name: 'Walmart' });
    const leche = product({ name: 'Leche Lala Entera', display_unit: 'L' });
    const l1 = variant(leche.row.id, { label: '1 L' });
    const l6 = variant(leche.row.id, { label: '6 × 1 L', pack_count: 6 });
    const pz = variant(leche.row.id, { label: '100 vasos', measure: 'count', unit_amount: 100 });
    await push([costco, walmart, leche, l1, l6, pz]);
    const at = (d: number) => now - d * DAY;
    await push([
      // 1 L at Walmart: 3 points in 90 days ($26.00 min, $28.50 newest) and one older than 90 days.
      observation(l1.row.id, walmart.row.id, { price_cents: 2600, observed_at: at(40) }),
      observation(l1.row.id, walmart.row.id, { price_cents: 3000, observed_at: at(20) }),
      observation(l1.row.id, walmart.row.id, { price_cents: 2850, observed_at: at(2) }),
      observation(l1.row.id, walmart.row.id, { price_cents: 1000, observed_at: at(120) }),
      // 6 × 1 L at Costco: newest $159.00 (26.50 per L) beats every newest 1 L price.
      observation(l6.row.id, costco.row.id, { price_cents: 15000, observed_at: at(30) }),
      observation(l6.row.id, costco.row.id, { price_cents: 15900, observed_at: at(1) }),
      // Another measure: 1 ¢ per piece is less than 2.65 ¢ per ml, but pieces never compete with liters.
      observation(pz.row.id, costco.row.id, { price_cents: 100, observed_at: at(1) }),
    ]);
    fx = { costco, walmart, leche, l1, l6, pz };
  });

  it('gives newest, lowest and average price per unit for each variant and store', async () => {
    const { status, body } = await get<CompareBody>(`/v1/products/${fx.leche!.row.id}/compare`);
    expect(status).toBe(200);
    expect(body.display_unit).toBe('L');
    expect(body.rows).toEqual([
      {
        variant_id: fx.l6!.row.id,
        store_id: fx.costco!.row.id,
        display_unit: 'L',
        last: { display_cents: 2650, observed_at: now - DAY, source: 'shelf' },
        min: { display_cents: 2500, observed_at: now - 30 * DAY },
        avg_display_cents: 2575,
        n: 2,
      },
      {
        variant_id: fx.l1!.row.id,
        store_id: fx.walmart!.row.id,
        display_unit: 'L',
        last: { display_cents: 2850, observed_at: now - 2 * DAY, source: 'shelf' },
        min: { display_cents: 2600, observed_at: now - 40 * DAY },
        avg_display_cents: 2817,
        n: 3,
      },
      {
        variant_id: fx.pz!.row.id,
        store_id: fx.costco!.row.id,
        display_unit: 'pz',
        last: { display_cents: 1, observed_at: now - DAY, source: 'shelf' },
        min: { display_cents: 1, observed_at: now - DAY },
        avg_display_cents: 1,
        n: 1,
      },
    ]);
    expect(body.best).toEqual({ variant_id: fx.l6!.row.id, store_id: fx.costco!.row.id });
  });

  it('best is the same variant and store as the product list (same rule, 03 §3)', async () => {
    const compare = await get<CompareBody>(`/v1/products/${fx.leche!.row.id}/compare`);
    const list = await get<{ items: Array<{ best: { variant_id: string; store_id: string } | null }> }>(
      '/v1/products',
    );
    expect(list.body.items[0]?.best).toMatchObject(compare.body.best!);
  });

  it('the window follows days', async () => {
    const { body } = await get<CompareBody>(`/v1/products/${fx.leche!.row.id}/compare?days=10`);
    expect(body.rows.map((r) => [r.variant_id, r.n])).toEqual([
      [fx.l6!.row.id, 1],
      [fx.l1!.row.id, 1],
      [fx.pz!.row.id, 1],
    ]);
    const wide = await get<CompareBody>(`/v1/products/${fx.leche!.row.id}/compare?days=365`);
    expect(wide.body.rows.find((r) => r.variant_id === fx.l1!.row.id)).toMatchObject({
      n: 4,
      min: { display_cents: 1000 },
    });
  });

  it('without points there is no best; validates and answers 404', async () => {
    const empty = product({ name: 'Sin precios' });
    await push([empty]);
    expect((await get<CompareBody>(`/v1/products/${empty.row.id}/compare`)).body).toEqual({
      display_unit: 'pz',
      rows: [],
      best: null,
    });
    expect((await get(`/v1/products/${fx.leche!.row.id}/compare?days=0`)).status).toBe(400);
    expect((await get(`/v1/products/${uuidv7()}/compare`)).status).toBe(404);
  });
});
