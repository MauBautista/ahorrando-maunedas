import { env } from 'cloudflare:workers';
import { uuidv7 } from '@maunedas/shared/util/uuid';
import type { AgentWorkResponse } from '@maunedas/shared/api/agent';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
