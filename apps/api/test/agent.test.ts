import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { uuidv7 } from '@maunedas/shared/util/uuid';
import type { AgentWorkResponse } from '@maunedas/shared/api/agent';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ingest } from '../src/agent/observations';
import { AGENT_OFFLINE_MARK, agentWork, MIN_SPACING_S, ONLINE_MS, STATUS_EVERY_MS } from '../src/agent/work';
import { product, store, syncHarness, variant, type Mutation } from './support/sync';

let h: Awaited<ReturnType<typeof syncHarness>>;
const MIN = 60_000;

beforeAll(async () => {
  h = await syncHarness();
});

const body = (o: Record<string, unknown> = {}) => ({
  agent_id: 'home',
  agent_version: '1.0.0',
  cursor: [0, ''],
  info: { outbox: 0, due: 3, mem_mb: 612, load1: 0.8, blocked: [], last_error: null },
  ...o,
});

async function work(payload: unknown, token: string | null = 'test-agent-token') {
  const res = await h.app.request(
    '/agent/v1/work',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(payload),
    },
    env as never,
  );
  return { status: res.status, body: await res.json<AgentWorkResponse & { error?: { code: string } }>() };
}

const version = async () =>
  Number(await env.DB.prepare(`SELECT value FROM sync_meta WHERE key = 'version'`).first('value'));
const status = () =>
  env.DB.prepare(`SELECT * FROM agent_status WHERE id = 'home'`).first<Record<string, unknown>>();

let fx: Record<string, string>;

beforeEach(async () => {
  await h.reset();
  await env.DB.prepare('DELETE FROM agent_status').run();
  const shop = store({ name: 'Amazon', kind: 'online', default_check_interval_min: 480 });
  const p = product();
  const v = variant(p.row.id);
  const res = await h.push([shop, p, v] as Mutation[], 'admin');
  expect(res.status).toBe(200);
  const listing = (id: string, version: number, o: { active?: number; deleted_at?: number | null } = {}) =>
    env.DB.prepare(
      `INSERT INTO listings (id, variant_id, store_id, adapter, url, canonical_url, external_id, active, deleted_at,
                             created_at, updated_at, version)
       VALUES (?1, ?2, ?3, 'amazon_mx', ?4, ?4, ?5, ?6, ?7, 1, 1, ?8)`,
    ).bind(
      id,
      v.row.id,
      shop.row.id,
      `https://www.amazon.com.mx/dp/${id.slice(-10)}`,
      id.slice(-10),
      o.active ?? 1,
      o.deleted_at ?? null,
      version,
    );
  const ids = { live: uuidv7(), off: uuidv7(), gone: uuidv7(), later: uuidv7() };
  await env.DB.batch([
    listing(ids.live, 101),
    listing(ids.off, 102, { active: 0 }),
    listing(ids.gone, 103, { deleted_at: 5 }),
    listing(ids.later, 104),
    // "Revisar ahora" on the live one; the later one was asked and already checked after.
    env.DB.prepare(
      'INSERT INTO listing_state (listing_id, last_checked_at, check_requested_at, updated_at) VALUES (?1, 10, 20, 1)',
    ).bind(ids.live),
    env.DB.prepare(
      'INSERT INTO listing_state (listing_id, last_checked_at, check_requested_at, updated_at) VALUES (?1, 30, 20, 1)',
    ).bind(ids.later),
    env.DB.prepare(
      `INSERT INTO images (id, owner_type, owner_id, role, source, created_at, updated_at) VALUES (?1, 'product', ?2, 'catalog', 'user', 1, 1)`,
    ).bind(uuidv7(), p.row.id),
  ]);
  const image = await env.DB.prepare('SELECT id FROM images LIMIT 1').first<{ id: string }>();
  await env.DB.batch(
    ['queued', 'queued', 'done'].map((s) =>
      env.DB.prepare(
        `INSERT INTO image_jobs (id, image_id, op, status, created_at, updated_at) VALUES (?1, ?2, 'remove_bg', ?3, 1, 1)`,
      ).bind(uuidv7(), image!.id, s),
    ),
  );
  fx = { ...ids, store: shop.row.id as string };
});

describe('/agent/v1 auth (07 §5, rule 9)', () => {
  it('takes only the agent token, compared by its hash', async () => {
    expect((await work(body(), null)).status).toBe(401);
    expect((await work(body(), 'otro-token')).status).toBe(401);
    // A user's Firebase token is not the agent's.
    expect((await work(body(), h.tokens.admin)).status).toBe(401);
    expect((await work(body())).status).toBe(200);
  });

  it('refuses a malformed body or an oversized info', async () => {
    expect((await work(body({ cursor: [-1, ''] }))).status).toBe(400);
    expect((await work(body({ agent_id: 'Casa Grande' }))).status).toBe(400);
    const big = body({ info: { ...body().info, notes: 'x'.repeat(5000) } });
    expect((await work(big)).status).toBe(413);
  });
});

describe('POST /agent/v1/work (07 §5.1)', () => {
  it('answers the listings after the cursor, what to check now, store defaults, image jobs and spacing', async () => {
    const { status: code, body: res } = await work(body());
    expect(code).toBe(200);
    expect(res.listings.upserts.map((l) => l.id)).toEqual([fx.live, fx.later]);
    expect(res.listings.upserts[0]).toEqual({
      id: fx.live,
      adapter: 'amazon_mx',
      url: `https://www.amazon.com.mx/dp/${fx.live!.slice(-10)}`,
      canonical_url: `https://www.amazon.com.mx/dp/${fx.live!.slice(-10)}`,
      external_id: fx.live!.slice(-10),
      store_id: fx.store,
      interval_min: null,
      active: 1,
      version: 101,
    });
    expect(res.listings.removed).toEqual([fx.off, fx.gone]);
    expect(res.listings).toMatchObject({ cursor: [104, fx.later], has_more: false });
    expect(res.store_defaults).toEqual({ [fx.store!]: 480 });
    expect(res.check_now).toEqual([fx.live]);
    expect(res.image_jobs_queued).toBe(2);
    expect(res.config).toEqual({ min_spacing_s: MIN_SPACING_S });
    // From the cursor on, nothing new.
    const next = await work(body({ cursor: res.listings.cursor }));
    expect(next.body.listings).toEqual({
      upserts: [],
      removed: [],
      cursor: [104, fx.later],
      has_more: false,
    });
  });

  it('pages the listings by version and id', async () => {
    const first = await agentWork(env.DB, body() as never, 1_000, 2);
    expect([
      first.listings.upserts.map((l) => l.id),
      first.listings.removed,
      first.listings.has_more,
    ]).toEqual([[fx.live], [fx.off], true]);
    const second = await agentWork(env.DB, body({ cursor: first.listings.cursor }) as never, 1_001, 2);
    expect([
      second.listings.upserts.map((l) => l.id),
      second.listings.removed,
      second.listings.has_more,
    ]).toEqual([[fx.later], [fx.gone], false]);
  });

  it('keeps the heartbeat and gives clients a new version only when it matters', async () => {
    const t0 = 1_000_000;
    const at = (t: number, o: Record<string, unknown> = {}) => agentWork(env.DB, body(o) as never, t);
    let v = await version();
    await at(t0);
    // First heartbeat: a new row with a version.
    expect(await status()).toMatchObject({
      last_heartbeat_at: t0,
      agent_version: '1.0.0',
      updated_at: t0,
      version: v + 1,
    });
    expect(JSON.parse(String((await status())!.info))).toMatchObject({ due: 3, blocked: [] });
    v = await version();
    // A minute later, nothing new for clients: the heartbeat moves, the version does not.
    await at(t0 + MIN, { agent_version: '1.0.1' });
    expect(await status()).toMatchObject({
      last_heartbeat_at: t0 + MIN,
      agent_version: '1.0.1',
      updated_at: t0,
      version: v,
    });
    expect(await version()).toBe(v);
    // A newly blocked store reaches clients at once; the same set in another order does not.
    await at(t0 + 2 * MIN, { info: { ...body().info, blocked: ['sams_mx', 'amazon_mx'] } });
    expect(await status()).toMatchObject({ version: v + 1, updated_at: t0 + 2 * MIN });
    await at(t0 + 3 * MIN, { info: { ...body().info, blocked: ['sams_mx', 'amazon_mx', 'sams_mx'] } });
    expect(await version()).toBe(v + 1);
    expect(JSON.parse(String((await status())!.info)).blocked).toEqual(['amazon_mx', 'sams_mx']);
    // Every 10 minutes the heartbeat reaches clients anyway.
    await at(t0 + 2 * MIN + STATUS_EVERY_MS, { info: { ...body().info, blocked: ['amazon_mx', 'sams_mx'] } });
    expect(await status()).toMatchObject({ version: v + 2 });
  });

  it('coming back after an outage reaches clients and clears the watchdog mark', async () => {
    const t0 = 2_000_000;
    await agentWork(env.DB, body() as never, t0);
    await env.DB.prepare('INSERT INTO token_cache (key, value, expires_at) VALUES (?1, ?2, ?3)')
      .bind(AGENT_OFFLINE_MARK, String(t0), t0 + 86_400_000)
      .run();
    const v = await version();
    // Within the online window the mark stays.
    await agentWork(env.DB, body() as never, t0 + ONLINE_MS - 1);
    expect(
      await env.DB.prepare('SELECT key FROM token_cache WHERE key = ?1').bind(AGENT_OFFLINE_MARK).first(),
    ).not.toBeNull();
    expect(await version()).toBe(v);
    await agentWork(env.DB, body() as never, t0 + 2 * ONLINE_MS);
    expect(await version()).toBe(v + 1);
    expect(
      await env.DB.prepare('SELECT key FROM token_cache WHERE key = ?1').bind(AGENT_OFFLINE_MARK).first(),
    ).toBeNull();
  });
});

describe('POST /agent/v1/observations (07 §5.2, §6)', () => {
  // A day ago: a check in the future would be taken as now (a wrong clock).
  const T = Date.now() - 86_400_000;
  const ok = (o: Record<string, unknown> = {}) => ({
    listing_id: fx.live,
    checked_at: T,
    status: 'ok',
    price_cents: 2899,
    list_price_cents: 3299,
    in_stock: true,
    promo_text: null,
    extra: { seller: 'Amazon México', method: 'http_jsonld' },
    error: null,
    ...o,
  });
  const state = (id = fx.live) =>
    env.DB.prepare('SELECT * FROM listing_state WHERE listing_id = ?1')
      .bind(id)
      .first<Record<string, unknown>>();
  const webObservations = () =>
    env.DB.prepare(`SELECT * FROM price_observations WHERE source = 'web' ORDER BY observed_at`)
      .all<Record<string, unknown>>()
      .then((r) => r.results);

  async function send(results: unknown[], token: string | null = 'test-agent-token') {
    const ctx = createExecutionContext();
    const res = await h.app.request(
      '/agent/v1/observations',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ results }),
      },
      env as never,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    return { status: res.status, body: await res.json<{ accepted: number; observations_created: number }>() };
  }

  it('records a web observation of the first check, with its state, both with one new version', async () => {
    const before = await version();
    const { status: code, body: res } = await send([ok()]);
    expect(code).toBe(200);
    expect(res).toEqual({ accepted: 1, observations_created: 1 });
    expect(await version()).toBe(before + 1);
    expect(await state()).toMatchObject({
      last_checked_at: T,
      last_status: 'ok',
      last_error: null,
      consecutive_failures: 0,
      last_price_cents: 2899,
      last_list_price_cents: 3299,
      last_in_stock: 1,
      last_promo_text: null,
      version: before + 1,
    });
    const [obs] = await webObservations();
    expect(obs).toMatchObject({
      listing_id: fx.live,
      store_id: fx.store,
      source: 'web',
      price_cents: 2899,
      list_price_cents: 3299,
      in_stock: 1,
      observed_at: T,
      updated_by: 'agent',
      deleted_at: null,
      version: before + 1,
    });
    expect(JSON.parse(String(obs!.extra))).toEqual({ seller: 'Amazon México', method: 'http_jsonld' });
    // Clients receive it like any other row.
    const pulled = await h.pull({ cursors: {} }, 'member');
    const body = await pulled.json<{
      changes: Record<string, Array<{ id?: string; listing_id?: string }>>;
    }>();
    expect(body.changes.price_observations?.map((o) => o.id)).toContain(obs!.id);
    expect(body.changes.listing_state?.map((s) => s.listing_id)).toContain(fx.live);
  });

  it('compresses by change: only price, list price, stock or promotion make a new observation', async () => {
    await send([ok()]);
    expect((await send([ok({ checked_at: T + 1 })])).body.observations_created).toBe(0);
    expect((await state())!.last_checked_at).toBe(T + 1);
    expect((await send([ok({ checked_at: T + 2, price_cents: 2799 })])).body.observations_created).toBe(1);
    expect(
      (await send([ok({ checked_at: T + 3, price_cents: 2799, list_price_cents: null })])).body
        .observations_created,
    ).toBe(1);
    expect(
      (await send([ok({ checked_at: T + 4, price_cents: 2799, list_price_cents: null, promo_text: '2x1' })]))
        .body.observations_created,
    ).toBe(1);
    expect(
      (
        await send([
          ok({
            checked_at: T + 5,
            price_cents: 2799,
            list_price_cents: null,
            promo_text: '2x1',
            in_stock: false,
          }),
        ])
      ).body.observations_created,
    ).toBe(1);
    expect(
      (await webObservations()).map((o) => [o.price_cents, o.list_price_cents, o.promo_text, o.in_stock]),
    ).toEqual([
      [2899, 3299, null, 1],
      [2799, 3299, null, 1],
      [2799, null, null, 1],
      [2799, null, '2x1', 1],
      [2799, null, '2x1', 0],
    ]);
  });

  it('ignores a retry of a check already taken, and orders several checks of one listing', async () => {
    await send([ok({ checked_at: T + 10 })]);
    const retry = await send([
      ok({ checked_at: T + 10, price_cents: 1 }),
      ok({ checked_at: T + 5, price_cents: 2 }),
    ]);
    expect(retry.body).toEqual({ accepted: 2, observations_created: 0 });
    expect((await state())!.last_price_cents).toBe(2899);
    // Out of order in the request: taken by checked_at, so the newest wins and each change is recorded.
    await send([
      ok({ checked_at: T + 30, price_cents: 2500 }),
      ok({ checked_at: T + 20, price_cents: 2600 }),
    ]);
    expect((await webObservations()).map((o) => o.price_cents)).toEqual([2899, 2600, 2500]);
    expect((await state())!.last_price_cents).toBe(2500);
    // Two equal checks in one request: the second compares against the first, so one observation.
    const same = await send([
      ok({ checked_at: T + 40, price_cents: 2400 }),
      ok({ checked_at: T + 50, price_cents: 2400 }),
    ]);
    expect(same.body.observations_created).toBe(1);
  });

  it('counts consecutive failures, keeps the last price, and records again once it is ok', async () => {
    await send([ok()]);
    await send([{ ...ok({ checked_at: T + 1, status: 'error', price_cents: null, error: 'timeout' }) }]);
    await send([{ ...ok({ checked_at: T + 2, status: 'error', price_cents: null, error: 'HTTP 500' }) }]);
    expect(await state()).toMatchObject({
      last_status: 'error',
      last_error: 'HTTP 500',
      consecutive_failures: 2,
      last_price_cents: 2899,
    });
    // The page answered: not found is no failure.
    await send([{ ...ok({ checked_at: T + 3, status: 'not_found', price_cents: null }) }]);
    expect(await state()).toMatchObject({
      last_status: 'not_found',
      consecutive_failures: 0,
      last_price_cents: 2899,
    });
    // Back to ok at the same price: after a check that was not ok, it is recorded again.
    expect((await send([ok({ checked_at: T + 4 })])).body.observations_created).toBe(1);
  });

  it('reports a listing that becomes blocked once, and makes no observation without a price', async () => {
    const first = await ingest(env.DB, [{ ...ok(), status: 'blocked', price_cents: null }] as never, T);
    expect(first.newlyBlocked).toEqual([fx.live]);
    const again = await ingest(
      env.DB,
      [{ ...ok({ checked_at: T + 1 }), status: 'blocked', price_cents: null }] as never,
      T + 1,
    );
    expect(again.newlyBlocked).toEqual([]);
    expect(await state()).toMatchObject({ last_status: 'blocked', consecutive_failures: 2 });
    // Out of stock without a price: the state says so, no observation (price_cents is required).
    const out = await ingest(
      env.DB,
      [ok({ checked_at: T + 2, price_cents: null, in_stock: false })] as never,
      T + 2,
    );
    expect(out.created).toEqual([]);
    expect(await state()).toMatchObject({
      last_status: 'ok',
      last_in_stock: 0,
      last_price_cents: null,
      consecutive_failures: 0,
    });
    // Back in stock with a price: observed, with what it was before for the alerts.
    const back = await ingest(env.DB, [ok({ checked_at: T + 3 })] as never, T + 3);
    expect(back.created[0]).toMatchObject({
      price_cents: 2899,
      in_stock: 1,
      prev: { last_in_stock: 0, last_status: 'ok' },
    });
  });

  it('takes a check from the future as now', async () => {
    const now = Date.now();
    await ingest(env.DB, [ok({ checked_at: now + 3_600_000 })] as never, now);
    expect((await state())!.last_checked_at).toBe(now + 5 * 60_000);
  });

  it('skips unknown or deleted listings, and refuses bad requests', async () => {
    const res = await send([ok({ listing_id: fx.gone }), ok({ listing_id: uuidv7() })]);
    expect(res.body).toEqual({ accepted: 2, observations_created: 0 });
    expect(await state(fx.gone)).toBeNull();
    expect((await send([ok()], null)).status).toBe(401);
    expect((await send([])).status).toBe(400);
    expect((await send(Array.from({ length: 21 }, (_, i) => ok({ checked_at: T + i })))).status).toBe(400);
    expect((await send([ok({ status: 'raro' })])).status).toBe(400);
    expect((await send([ok({ price_cents: 28.99 })])).status).toBe(400);
  });
});
