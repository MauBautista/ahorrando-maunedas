import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { uuidv7 } from '@maunedas/shared/util/uuid';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ingest } from '../src/agent/observations';
import { deliverPending, evaluateAlerts } from '../src/alerts/engine';
import { shouldFire } from '../src/alerts/evaluate';
import { alertMessage } from '../src/alerts/messages';
import {
  ADMIN_ID,
  item,
  MEMBER_ID,
  product,
  purchase,
  store,
  syncHarness,
  variant,
  type Mutation,
} from './support/sync';

let h: Awaited<ReturnType<typeof syncHarness>>;
const HOUR = 3_600_000;
const NOW = Date.now();

beforeAll(async () => {
  h = await syncHarness();
});

const obs = (priceCents: number, o: Record<string, unknown> = {}) => ({
  priceCents,
  centsPerBase: priceCents / 1000,
  listPriceCents: null,
  inStock: true,
  promoText: null,
  ...o,
});
const prev = (priceCents: number | null, o: Record<string, unknown> = {}) => ({
  priceCents,
  listPriceCents: null,
  inStock: true,
  promoText: null,
  ...o,
});
const rule = (type: string, o: Record<string, unknown> = {}) =>
  ({ type, threshold_cents: null, threshold_pct: null, ...o }) as never;

describe('rule semantics (08 §3, cases 1–9 of §8)', () => {
  it('below_price fires when it crosses the threshold, or on the first check', () => {
    const below = rule('below_price', { threshold_cents: 3000 });
    expect(shouldFire(below, obs(2900), prev(3200), null)).toBe(true); // 1
    expect(shouldFire(below, obs(2800), prev(2900), null)).toBe(false); // 2
    expect(shouldFire(below, obs(2900), null, null)).toBe(true); // 3
    expect(shouldFire(below, obs(3000), prev(3001), null)).toBe(true);
    // A previous state without a price is no previous price.
    expect(shouldFire(below, obs(2900), prev(null), null)).toBe(true);
  });

  it('drop_pct fires at the percentage exactly', () => {
    const drop = rule('drop_pct', { threshold_pct: 10 });
    expect(shouldFire(drop, obs(900), prev(1000), null)).toBe(true); // 4
    expect(shouldFire(drop, obs(901), prev(1000), null)).toBe(false); // 5
    expect(shouldFire(drop, obs(900), null, null)).toBe(false);
    expect(shouldFire(drop, obs(900), prev(null), null)).toBe(false);
  });

  it('new_low fires below the scope’s minimum, never without history', () => {
    // 2.60 ¢/ml against purchases at 2.65 ¢/ml.
    expect(shouldFire(rule('new_low'), obs(2600), null, 2.65)).toBe(true); // 6
    expect(shouldFire(rule('new_low'), obs(2600), null, null)).toBe(false); // 7
    expect(shouldFire(rule('new_low'), obs(2650), null, 2.65)).toBe(false);
  });

  it('back_in_stock needs a previous check out of stock', () => {
    expect(shouldFire(rule('back_in_stock'), obs(2900), prev(2900, { inStock: false }), null)).toBe(true); // 8
    expect(shouldFire(rule('back_in_stock'), obs(2900), null, null)).toBe(false);
  });

  it('promo fires on a new text or a new strikethrough price, once', () => {
    const strike = obs(2899, { listPriceCents: 3299 });
    expect(shouldFire(rule('promo'), strike, prev(2899), null)).toBe(true); // 9
    expect(shouldFire(rule('promo'), strike, prev(2899, { listPriceCents: 3299 }), null)).toBe(false);
    expect(shouldFire(rule('promo'), obs(2899, { promoText: '2x1' }), prev(2899), null)).toBe(true);
    expect(
      shouldFire(rule('promo'), obs(2899, { promoText: '2x1' }), prev(2899, { promoText: '2x1' }), null),
    ).toBe(false);
  });
});

describe('messages (08 §5)', () => {
  const facts = {
    product: 'Leche Lala Entera · 1 L',
    store: 'Walmart',
    priceCents: 2490,
    listPriceCents: 2990,
    promoText: null,
    perUnitCents: 2490,
    unit: 'L' as const,
    prevPriceCents: 2790,
    thresholdCents: 2500,
    promoIsText: false,
  };

  it('reads as the SDD says, with amounts as es-MX writes them', () => {
    expect(alertMessage('new_low', facts)).toEqual({
      title: 'Precio más bajo registrado',
      body: 'Leche Lala Entera · 1 L en Walmart: $24.90 ($24.90/L).',
    });
    expect(alertMessage('below_price', facts)).toEqual({
      title: 'Leche Lala Entera · 1 L bajó a $24.90',
      body: 'En Walmart. Tu objetivo: $25.00.',
    });
    expect(alertMessage('drop_pct', facts)).toEqual({
      title: 'Leche Lala Entera · 1 L bajó 11 %',
      body: 'En Walmart: de $27.90 a $24.90.',
    });
    expect(alertMessage('promo', facts)).toEqual({
      title: 'Promoción en Leche Lala Entera · 1 L',
      body: 'Walmart: antes $29.90, ahora $24.90.',
    });
    expect(alertMessage('promo', { ...facts, promoText: '2x1', promoIsText: true }).body).toBe(
      'Walmart: 2x1',
    );
    expect(alertMessage('back_in_stock', facts)).toEqual({
      title: 'Leche Lala Entera · 1 L volvió a haber',
      body: 'En Walmart a $24.90.',
    });
  });
});

describe('the alert engine (08 §1–4)', () => {
  let fx: Record<string, string>;
  const sent: Array<{ user: string; data: Record<string, string> }> = [];
  const spy = async (_env: unknown, user: string, data: Record<string, string>) => {
    sent.push({ user, data });
    return 'sent' as const;
  };

  beforeEach(async () => {
    sent.length = 0;
    await h.reset();
    const shop = store({ name: 'Walmart', kind: 'both' });
    const p = product({ name: 'Leche Lala Entera', display_unit: 'L' });
    const v = variant(p.row.id, { label: '1 L', unit_amount: 1000 });
    expect((await h.push([shop, p, v] as Mutation[], 'admin')).status).toBe(200);
    const listing = uuidv7();
    const other = uuidv7();
    await env.DB.batch(
      [listing, other].map((id) =>
        env.DB.prepare(
          `INSERT INTO listings (id, variant_id, store_id, adapter, url, created_at, updated_at, version)
           VALUES (?1, ?2, ?3, 'amazon_mx', 'https://www.amazon.com.mx/dp/B000000001', 1, 1, 1)`,
        ).bind(id, v.row.id, shop.row.id),
      ),
    );
    fx = { listing, other, variant: v.row.id as string, store: shop.row.id as string };
  });

  const addRule = async (o: Record<string, unknown>) => {
    const id = uuidv7();
    await env.DB.prepare(
      `INSERT INTO alert_rules (id, user_id, variant_id, listing_id, type, threshold_cents, threshold_pct, scope,
                                cooldown_hours, active, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 1, 1, 1)`,
    )
      .bind(
        id,
        o.user ?? MEMBER_ID,
        fx.variant,
        o.listing ?? null,
        o.type,
        o.threshold_cents ?? null,
        o.threshold_pct ?? null,
        o.scope ?? 'variant_web',
        o.cooldown ?? 24,
      )
      .run();
    return id;
  };
  const check = (price: number, at: number, listing = fx.listing, o: Record<string, unknown> = {}) =>
    ({
      listing_id: listing,
      checked_at: at,
      status: 'ok',
      price_cents: price,
      list_price_cents: null,
      in_stock: true,
      promo_text: null,
      extra: null,
      error: null,
      ...o,
    }) as never;
  const events = () =>
    env.DB.prepare('SELECT * FROM alert_events ORDER BY title')
      .all<Record<string, unknown>>()
      .then((r) => r.results);

  it('sends one notification of the highest priority and one event per rule (case 10)', async () => {
    const below = await addRule({ type: 'below_price', threshold_cents: 3000 });
    const drop = await addRule({ type: 'drop_pct', threshold_pct: 10 });
    await addRule({ type: 'below_price', threshold_cents: 1000, user: ADMIN_ID });
    // Bound to another listing of the variant: it does not hear this one.
    await addRule({ type: 'below_price', threshold_cents: 3000, listing: fx.other });
    await ingest(env.DB, [check(3200, NOW - 2 * HOUR)], NOW - 2 * HOUR);
    const { created } = await ingest(env.DB, [check(2800, NOW - HOUR)], NOW - HOUR);
    expect(await evaluateAlerts(env, created, NOW, spy)).toBe(2);
    expect(sent).toEqual([
      {
        user: MEMBER_ID,
        data: {
          type: 'price_alert',
          title: 'Leche Lala Entera · 1 L bajó a $28.00',
          body: 'En Walmart. Tu objetivo: $30.00.',
          variant_id: fx.variant,
          listing_id: fx.listing,
          event_id: expect.any(String),
          channel: 'price_alerts',
        },
      },
    ]);
    const rows = await events();
    expect(rows.map((e) => [e.rule_id, e.user_id, e.delivery_status, e.observation_id])).toEqual([
      [drop, MEMBER_ID, 'sent', created[0]!.id],
      [below, MEMBER_ID, 'sent', created[0]!.id],
    ]);
    expect(rows.find((e) => e.rule_id === below)!.id).toBe(sent[0]!.data.event_id);
    expect(rows.find((e) => e.rule_id === drop)!.title).toBe('Leche Lala Entera · 1 L bajó 13 %');
  });

  it('keeps a rule silent within its cooldown, also for a second observation of the same run (case 11)', async () => {
    const silent = await addRule({ type: 'below_price', threshold_cents: 3000 });
    await env.DB.prepare(
      `INSERT INTO alert_events (id, rule_id, user_id, fired_at, title, body, delivery_status) VALUES (?1, ?2, ?3, ?4, 't', 'b', 'sent')`,
    )
      .bind(uuidv7(), silent, MEMBER_ID, NOW - 2 * HOUR)
      .run();
    const a = await ingest(env.DB, [check(2900, NOW - HOUR)], NOW - HOUR);
    expect(await evaluateAlerts(env, a.created, NOW, spy)).toBe(0);
    // A rule out of its cooldown fires for the first of two listings only.
    const any = await addRule({ type: 'new_low', scope: 'variant_web', cooldown: 1 });
    await ingest(env.DB, [check(5000, NOW - 3 * HOUR, fx.other)], NOW - 3 * HOUR);
    const both = await ingest(
      env.DB,
      [check(2500, NOW - 30 * 60_000), check(2400, NOW - 20 * 60_000, fx.other)],
      NOW - 20 * 60_000,
    );
    expect(await evaluateAlerts(env, both.created, NOW, spy)).toBe(1);
    expect((await events()).filter((e) => e.rule_id === any)).toHaveLength(1);
  });

  it('new_low compares with the scope’s history without itself, purchases included in variant_all (cases 6, 7)', async () => {
    const all = await addRule({ type: 'new_low', scope: 'variant_all' });
    const web = await addRule({ type: 'new_low', scope: 'variant_web', user: ADMIN_ID });
    // No history at all: nothing fires.
    const first = await ingest(env.DB, [check(2700, NOW - 3 * HOUR)], NOW - 3 * HOUR);
    expect(await evaluateAlerts(env, first.created, NOW - 3 * HOUR, spy)).toBe(0);
    // A purchase at 2.65 ¢/ml.
    const buy = purchase(fx.store!, { status: 'confirmed', purchased_at: NOW - 5 * HOUR });
    expect(
      (
        await h.push([
          buy,
          item(buy.row.id as string, fx.variant!, {
            unit_price_cents: 2650,
            gross_cents: 2650,
            final_cents: 2650,
          }),
        ] as Mutation[])
      ).status,
    ).toBe(200);
    // 2.68 ¢/ml: below the web history (2.70) but not below the purchase (2.65), so only variant_web fires.
    const mid = await ingest(env.DB, [check(2680, NOW - 2 * HOUR)], NOW - 2 * HOUR);
    expect(await evaluateAlerts(env, mid.created, NOW - 2 * HOUR, spy)).toBe(1);
    expect(sent.map((s) => s.user)).toEqual([ADMIN_ID]);
    // 2.60 ¢/ml: below the purchase too; the web rule is in its cooldown.
    sent.length = 0;
    const low = await ingest(env.DB, [check(2600, NOW - HOUR)], NOW - HOUR);
    expect(await evaluateAlerts(env, low.created, NOW - HOUR, spy)).toBe(1);
    expect(sent).toEqual([
      {
        user: MEMBER_ID,
        data: expect.objectContaining({ body: 'Leche Lala Entera · 1 L en Walmart: $26.00 ($26.00/L).' }),
      },
    ]);
    // 2.62 ¢/ml is above the new minimum of 2.60: nothing fires, even two days later, out of every cooldown.
    sent.length = 0;
    const again = await ingest(env.DB, [check(2620, NOW - 30 * 60_000)], NOW - 30 * 60_000);
    expect(await evaluateAlerts(env, again.created, NOW + 49 * HOUR, spy)).toBe(0);
    expect((await events()).map((e) => e.rule_id).sort()).toEqual([all, web].sort());
  });

  it('delivers nothing yet without FCM (T-213): no devices, or failed when there are tokens', async () => {
    expect(await deliverPending(env, MEMBER_ID, {})).toBe('no_devices');
    await env.DB.prepare(
      `INSERT INTO devices (id, user_id, platform, fcm_token, created_at) VALUES (?1, ?2, 'android', 'token', 1)`,
    )
      .bind(uuidv7(), MEMBER_ID)
      .run();
    expect(await deliverPending(env, MEMBER_ID, {})).toBe('failed');
  });

  it('runs after the agent’s answer and the user sees only their alerts, newest first', async () => {
    await addRule({ type: 'below_price', threshold_cents: 3000 });
    await addRule({ type: 'below_price', threshold_cents: 3000, user: ADMIN_ID });
    for (const [price, at] of [
      [3200, NOW - 4 * HOUR],
      [2900, NOW - 3 * HOUR],
    ] as const) {
      const ctx = createExecutionContext();
      const res = await h.app.request(
        '/agent/v1/observations',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-agent-token' },
          body: JSON.stringify({ results: [check(price, at)] }),
        },
        env as never,
        ctx,
      );
      expect(res.status).toBe(200);
      await waitOnExecutionContext(ctx);
    }
    expect((await events()).map((e) => e.delivery_status)).toEqual(['no_devices', 'no_devices']);
    // A second member event later, to page.
    const rows = await events();
    await env.DB.prepare(
      `INSERT INTO alert_events (id, rule_id, user_id, fired_at, title, body, delivery_status) VALUES (?1, ?2, ?3, ?4, 'Más nuevo', 'b', 'sent')`,
    )
      .bind(uuidv7(), rows.find((e) => e.user_id === MEMBER_ID)!.rule_id, MEMBER_ID, NOW + HOUR)
      .run();
    const get = async (q: string) => {
      const res = await h.app.request(
        `/v1/alerts/events${q}`,
        { headers: { Authorization: `Bearer ${h.tokens.member}`, 'X-Client-Schema': '1' } },
        env as never,
      );
      return res.json<{ items: Array<{ user_id: string; title: string }>; next_cursor: string | null }>();
    };
    const page1 = await get('?limit=1');
    expect(page1.items.map((e) => e.title)).toEqual(['Más nuevo']);
    const page2 = await get(`?limit=1&cursor=${page1.next_cursor}`);
    expect(page2.items.map((e) => [e.user_id, e.title])).toEqual([
      [MEMBER_ID, 'Leche Lala Entera · 1 L bajó a $29.00'],
    ]);
    expect(page2.next_cursor).toBeNull();
  });
});
