import { env } from 'cloudflare:workers';
import { uuidv7 } from '@maunedas/shared/util/uuid';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { agentWork } from '../src/agent/work';
import { product, store, syncHarness, variant, type Mutation } from './support/sync';

const PRODUCT = 'https://www.amazon.com.mx/Leche-Lala/dp/B07XJ8C8F5/ref=sr_1_3?keywords=leche';
const seen: Array<{ url: string; redirect: string | undefined }> = [];
/** Short links as Amazon answers them: only redirects; any other page fetch is a test failure. */
const fakeFetch: typeof fetch = async (input, init) => {
  const url = String(input);
  seen.push({ url, redirect: init?.redirect });
  const redirect = (to: string, status = 301) => new Response(null, { status, headers: { Location: to } });
  if (url === 'https://amzn.to/leche') return redirect(PRODUCT);
  if (url === 'https://a.co/d/leche') return redirect('https://amzn.to/leche', 302);
  if (url === 'https://amzn.to/loop') return redirect('https://a.co/d/loop');
  if (url === 'https://a.co/d/loop') return redirect('https://amzn.to/loop');
  if (url === 'https://amzn.to/relative') return redirect('//www.amazon.com.mx/dp/B07XJ8C8F5');
  if (url === 'https://amzn.to/broken') return new Response('ok');
  if (url === 'https://amzn.to/offline') throw new TypeError('network');
  throw new Error(`unexpected fetch ${url}`);
};

/** What these routes answer, as the tests read it. */
interface Body {
  error?: { code?: string; details?: { reason?: string } };
  items?: unknown;
  [key: string]: unknown;
}

let h: Awaited<ReturnType<typeof syncHarness>>;
let fx: Record<string, string>;

beforeAll(async () => {
  h = await syncHarness({ fetch: fakeFetch });
});

async function call(method: string, path: string, body?: unknown, as: 'admin' | 'member' | null = 'member') {
  const res = await h.app.request(
    path,
    {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Schema': '1',
        ...(as ? { Authorization: `Bearer ${h.tokens[as]}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    env as never,
  );
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Body) : null };
}

beforeEach(async () => {
  await h.reset();
  seen.length = 0;
  const amazon = store({ name: 'Amazon', kind: 'online', adapter: 'amazon_mx' });
  const p = product();
  const v = variant(p.row.id);
  expect((await h.push([amazon, p, v] as Mutation[], 'admin')).status).toBe(200);
  fx = { amazon: amazon.row.id as string, variant: v.row.id as string };
});

describe('POST /v1/listings/resolve (03 §11)', () => {
  it('resolves a product link to its adapter, store and canonical URL without fetching anything', async () => {
    const res = await call('POST', '/v1/listings/resolve', { url: PRODUCT });
    expect(res).toEqual({
      status: 200,
      body: {
        adapter: 'amazon_mx',
        store_id: fx.amazon,
        url: PRODUCT,
        canonical_url: 'https://www.amazon.com.mx/dp/B07XJ8C8F5',
        external_id: 'B07XJ8C8F5',
      },
    });
    expect(seen).toEqual([]);
  });

  it('follows short links by their Location only, from a shared text', async () => {
    const res = await call('POST', '/v1/listings/resolve', {
      url: 'Mira esto https://a.co/d/leche ¡está barato!',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      url: 'https://a.co/d/leche',
      canonical_url: 'https://www.amazon.com.mx/dp/B07XJ8C8F5',
    });
    expect(seen).toEqual([
      { url: 'https://a.co/d/leche', redirect: 'manual' },
      { url: 'https://amzn.to/leche', redirect: 'manual' },
    ]);
    // A Location without scheme is taken against the link it came from.
    const relative = await call('POST', '/v1/listings/resolve', { url: 'https://amzn.to/relative' });
    expect(relative.body).toMatchObject({ canonical_url: 'https://www.amazon.com.mx/dp/B07XJ8C8F5' });
  });

  it('refuses what cannot be tracked, saying why', async () => {
    const reason = async (url: string) =>
      (await call('POST', '/v1/listings/resolve', { url })).body?.error?.details?.reason;
    expect(await reason('sin enlace')).toBe('NO_URL');
    expect(await reason('https://www.walmart.com.mx/ip/leche/00750102051534')).toBe('NOT_TRACKED');
    expect(await reason('https://www.amazon.com.mx/s?k=leche')).toBe('NOT_TRACKED');
    expect(await reason('https://amzn.to/loop')).toBe('SHORT_LINK');
    expect(await reason('https://amzn.to/broken')).toBe('SHORT_LINK');
    expect(await reason('https://amzn.to/offline')).toBe('SHORT_LINK');
    // A store with the adapter must exist (seeded in every environment).
    expect(await reason('https://www.costco.com.mx/p/123456')).toBe('NO_STORE');
    const res = await call('POST', '/v1/listings/resolve', { url: 'https://www.walmart.com.mx/ip/x/1' });
    expect([res.status, res.body?.error?.code]).toEqual([422, 'UNSUPPORTED_URL']);
    expect((await call('POST', '/v1/listings/resolve', { url: PRODUCT }, null)).status).toBe(401);
    expect((await call('POST', '/v1/listings/resolve', {})).status).toBe(400);
  });
});

describe('listings: check now and list (03 §11)', () => {
  const insert = (o: { deleted?: number | null } = {}) => {
    const id = uuidv7();
    return {
      id,
      stmt: env.DB.prepare(
        `INSERT INTO listings (id, variant_id, store_id, adapter, url, canonical_url, external_id, deleted_at, created_at, updated_at, version)
         VALUES (?1, ?2, ?3, 'amazon_mx', ?4, ?4, 'B07XJ8C8F5', ?5, 1, 1, 1)`,
      ).bind(id, fx.variant, fx.amazon, PRODUCT, o.deleted ?? null),
    };
  };

  it('asks the agent to check now, creating or updating the listing state with a new version', async () => {
    const a = insert();
    const gone = insert({ deleted: 5 });
    await env.DB.batch([
      a.stmt,
      gone.stmt,
      env.DB.prepare(
        `INSERT INTO listing_state (listing_id, last_checked_at, last_status, last_price_cents, updated_at) VALUES (?1, 10, 'ok', 2899, 10)`,
      ).bind(a.id),
    ]);
    const before = Number(
      await env.DB.prepare(`SELECT value FROM sync_meta WHERE key = 'version'`).first('value'),
    );
    const res = await call('POST', `/v1/listings/${a.id}/check-now`);
    expect([res.status, res.body]).toEqual([202, null]);
    const state = await env.DB.prepare('SELECT * FROM listing_state WHERE listing_id = ?1')
      .bind(a.id)
      .first<Record<string, number>>();
    expect(state).toMatchObject({ last_status: 'ok', last_price_cents: 2899, version: before + 1 });
    expect(state!.check_requested_at).toBeGreaterThan(10);
    const work = await agentWork(
      env.DB,
      {
        agent_id: 'home',
        agent_version: '1',
        cursor: [0, ''],
        info: { outbox: 0, due: 0, mem_mb: 1, load1: 0, blocked: [], last_error: null },
      } as never,
      Date.now(),
    );
    expect(work.check_now).toEqual([a.id]);
    // A listing without state gets one.
    const b = insert();
    await b.stmt.run();
    expect((await call('POST', `/v1/listings/${b.id}/check-now`)).status).toBe(202);
    expect(
      await env.DB.prepare('SELECT check_requested_at FROM listing_state WHERE listing_id = ?1')
        .bind(b.id)
        .first('check_requested_at'),
    ).toEqual(expect.any(Number));
    expect((await call('POST', `/v1/listings/${gone.id}/check-now`)).status).toBe(404);
    expect((await call('POST', `/v1/listings/${uuidv7()}/check-now`)).status).toBe(404);
    expect((await call('POST', '/v1/listings/abc/check-now')).status).toBe(400);
  });

  it('lists the live listings of a variant with their state', async () => {
    const a = insert();
    const b = insert();
    const gone = insert({ deleted: 5 });
    await env.DB.batch([
      a.stmt,
      b.stmt,
      gone.stmt,
      env.DB.prepare(
        `INSERT INTO listing_state (listing_id, last_checked_at, last_status, consecutive_failures, last_price_cents, last_in_stock, updated_at, version) VALUES (?1, 20, 'ok', 0, 2899, 1, 20, 7)`,
      ).bind(a.id),
    ]);
    const res = await call('GET', `/v1/listings?variant_id=${fx.variant}`);
    expect(res.status).toBe(200);
    const items = res.body!.items as Array<Record<string, unknown>>;
    expect(items.map((l) => l.id).sort()).toEqual([a.id, b.id].sort());
    const withState = items.find((l) => l.id === a.id)!;
    expect(withState).toMatchObject({
      adapter: 'amazon_mx',
      canonical_url: PRODUCT,
      external_id: 'B07XJ8C8F5',
      active: 1,
      product_name: 'Leche Lala Entera',
      brand: null,
      variant_label: '1 L',
      store_name: 'Amazon',
    });
    expect(withState.product_id).toEqual(expect.any(String));
    expect(withState.state).toMatchObject({
      listing_id: a.id,
      last_status: 'ok',
      last_price_cents: 2899,
      last_in_stock: 1,
      version: 7,
    });
    expect(items.find((l) => l.id === b.id)!.state).toBeNull();

    // Without a variant: every live listing, by product, variant and store (W-20).
    const p2 = product({ name: 'Atún Dolores', brand: 'Dolores' });
    const v2 = variant(p2.row.id, { label: '140 g', measure: 'mass', unit_amount: 140 });
    expect((await h.push([p2, v2] as Mutation[], 'member')).status).toBe(200);
    const tuna = uuidv7();
    await env.DB.prepare(
      `INSERT INTO listings (id, variant_id, store_id, adapter, url, created_at, updated_at, version)
       VALUES (?1, ?2, ?3, 'amazon_mx', 'https://www.amazon.com.mx/dp/B000000002', 1, 1, 1)`,
    )
      .bind(tuna, v2.row.id, fx.amazon)
      .run();
    const every = (await call('GET', '/v1/listings')).body!.items as Array<Record<string, unknown>>;
    expect(every.map((l) => [l.product_name, l.variant_label])).toEqual([
      ['Atún Dolores', '140 g'],
      ['Leche Lala Entera', '1 L'],
      ['Leche Lala Entera', '1 L'],
    ]);
    expect(every[0]).toMatchObject({ id: tuna, brand: 'Dolores', state: null });
    expect((await call('GET', `/v1/listings?variant_id=${v2.row.id}`)).body!.items).toHaveLength(1);
    expect((await call('GET', '/v1/listings?variant_id=abc')).status).toBe(400);
  });
});
