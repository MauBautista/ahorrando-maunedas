import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type {
  HaTokenCreated,
  HaTokensResponse,
  HaVariant,
  HaVariantsResponse,
} from '@maunedas/shared/api/ha';
import { uuidv7 } from '@maunedas/shared/util/uuid';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sha256Hex } from '../src/util/sha256';
import { observation, product, store, syncHarness, variant, type Mutation } from './support/sync';

const DAY = 86_400_000;

let h: Awaited<ReturnType<typeof syncHarness>>;
let fx: Record<string, string>;

beforeAll(async () => {
  h = await syncHarness();
});

/** A user session (`/v1`) or a Home Assistant token (`/ha/v1`), with the context `waitUntil` needs. */
async function call(
  method: string,
  path: string,
  auth: { as?: 'admin' | 'member'; token?: string } = {},
  body?: unknown,
) {
  const ctx = createExecutionContext();
  const bearer = auth.token ?? (auth.as ? h.tokens[auth.as] : undefined);
  const res = await h.app.request(
    path,
    {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Schema': '1',
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    env as never,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function newToken(name = 'Casa'): Promise<HaTokenCreated> {
  const res = await call('POST', '/v1/admin/ha-tokens', { as: 'admin' }, { name });
  expect(res.status).toBe(201);
  return res.body as HaTokenCreated;
}

beforeEach(async () => {
  await h.reset();
  const amazon = store({ name: 'Amazon', kind: 'online', adapter: 'amazon_mx' });
  const walmart = store({ name: 'Walmart', kind: 'both' });
  const soriana = store({ name: 'Soriana', kind: 'physical' });
  const p = product({ name: 'Leche Lala Entera', display_unit: 'L' });
  const liter = variant(p.row.id, { label: '1 L' });
  const six = variant(p.row.id, { label: '6 × 1 L', pack_count: 6 });
  const now = Date.now();
  expect(
    (
      await h.push(
        [
          amazon,
          walmart,
          soriana,
          p,
          liter,
          six,
          observation(liter.row.id, walmart.row.id, { price_cents: 2500, observed_at: now - 100 * DAY }),
          // The lowest ever, and Soriana's only price: too old to be "current".
          observation(liter.row.id, soriana.row.id, { price_cents: 2400, observed_at: now - 95 * DAY }),
          observation(liter.row.id, walmart.row.id, { price_cents: 3000, observed_at: now - 20 * DAY }),
          observation(liter.row.id, walmart.row.id, { price_cents: 2900, observed_at: now - 2 * DAY }),
        ] as Mutation[],
        'admin',
      )
    ).status,
  ).toBe(200);
  const listing = uuidv7();
  const paused = uuidv7();
  await env.DB.batch([
    // A paused link says nothing about stock.
    env.DB.prepare(
      `INSERT INTO listings (id, variant_id, store_id, adapter, url, active, created_at, updated_at, version)
       VALUES (?1, ?2, ?3, 'amazon_mx', 'https://www.amazon.com.mx/dp/B000000002', 0, 1, 1, 1)`,
    ).bind(paused, liter.row.id, walmart.row.id),
    env.DB.prepare(
      `INSERT INTO listing_state (listing_id, last_checked_at, last_status, last_price_cents, last_in_stock,
         consecutive_failures, updated_at, version) VALUES (?1, ?2, 'ok', 2600, 0, 0, 1, 1)`,
    ).bind(paused, now - DAY),
    env.DB.prepare(
      `INSERT INTO listings (id, variant_id, store_id, adapter, url, created_at, updated_at, version)
       VALUES (?1, ?2, ?3, 'amazon_mx', 'https://www.amazon.com.mx/dp/B000000001', 1, 1, 1)`,
    ).bind(listing, liter.row.id, amazon.row.id),
    env.DB.prepare(
      `INSERT INTO listing_state (listing_id, last_checked_at, last_status, last_price_cents, last_in_stock,
         consecutive_failures, updated_at, version) VALUES (?1, ?2, 'ok', 2700, 1, 0, 1, 1)`,
    ).bind(listing, now - DAY),
    env.DB.prepare(
      `INSERT INTO price_observations (id, variant_id, store_id, listing_id, source, price_cents, observed_at,
         created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 'web', 2700, ?5, 1, 1)`,
    ).bind(uuidv7(), liter.row.id, amazon.row.id, listing, now - DAY),
  ]);
  fx = { liter: liter.row.id as string, six: six.row.id as string, now: String(now) };
});

describe('Home Assistant tokens (T-308, 03 §13)', () => {
  it('are made by an admin, shown once and kept only as their hash', async () => {
    const created = await newToken('  Casa  ');
    expect(created.token).toMatch(/^mha_[A-Za-z0-9_-]{43}$/);
    expect(created).toMatchObject({
      name: 'Casa',
      created_by_name: expect.any(String),
      last_used_at: null,
      revoked_at: null,
    });
    const row = await env.DB.prepare('SELECT * FROM ha_tokens WHERE id = ?1')
      .bind(created.id)
      .first<Record<string, unknown>>();
    expect(row!.token_sha256).toBe(await sha256Hex(created.token));
    expect(Object.values(row!)).not.toContain(created.token);
    const list = (await call('GET', '/v1/admin/ha-tokens', { as: 'admin' })).body as HaTokensResponse;
    expect(list.items).toEqual([
      {
        id: created.id,
        name: 'Casa',
        created_by_name: created.created_by_name,
        created_at: created.created_at,
        last_used_at: null,
        revoked_at: null,
      },
    ]);
    expect(JSON.stringify(list)).not.toContain(created.token);
  });

  it('are only for admins and need a name', async () => {
    expect((await call('POST', '/v1/admin/ha-tokens', { as: 'member' }, { name: 'Casa' })).status).toBe(403);
    expect((await call('GET', '/v1/admin/ha-tokens', { as: 'member' })).status).toBe(403);
    expect((await call('DELETE', `/v1/admin/ha-tokens/${uuidv7()}`, { as: 'member' })).status).toBe(403);
    expect((await call('POST', '/v1/admin/ha-tokens', { as: 'admin' }, { name: '   ' })).status).toBe(400);
    expect(
      (await call('POST', '/v1/admin/ha-tokens', { as: 'admin' }, { name: 'x'.repeat(61) })).status,
    ).toBe(400);
  });

  it('stop working when revoked, which keeps the row and goes last', async () => {
    // The newer one is revoked, so only "revoked last" puts it after the older one.
    const kept = await newToken('Primera');
    const old = await newToken('Segunda');
    expect((await call('GET', '/ha/v1/variants', { token: old.token })).status).toBe(200);
    expect((await call('DELETE', `/v1/admin/ha-tokens/${old.id}`, { as: 'admin' })).status).toBe(204);
    expect((await call('GET', '/ha/v1/variants', { token: old.token })).status).toBe(401);
    expect((await call('GET', '/ha/v1/variants', { token: kept.token })).status).toBe(200);
    // Again is the same; an unknown one is 404.
    const first = (await env.DB.prepare('SELECT revoked_at FROM ha_tokens WHERE id = ?1')
      .bind(old.id)
      .first<{ revoked_at: number }>())!.revoked_at;
    expect((await call('DELETE', `/v1/admin/ha-tokens/${old.id}`, { as: 'admin' })).status).toBe(204);
    expect(
      (await env.DB.prepare('SELECT revoked_at FROM ha_tokens WHERE id = ?1')
        .bind(old.id)
        .first<{ revoked_at: number }>())!.revoked_at,
    ).toBe(first);
    expect((await call('DELETE', `/v1/admin/ha-tokens/${uuidv7()}`, { as: 'admin' })).status).toBe(404);
    const list = (await call('GET', '/v1/admin/ha-tokens', { as: 'admin' })).body as HaTokensResponse;
    expect(list.items.map((t) => [t.name, t.revoked_at !== null])).toEqual([
      ['Primera', false],
      ['Segunda', true],
    ]);
  });
});

describe('GET /ha/v1/variants (T-308, 03 §13)', () => {
  it('needs a live token, and the token opens nothing else', async () => {
    const { token } = await newToken();
    expect((await call('GET', '/ha/v1/variants')).status).toBe(401);
    expect((await call('GET', '/ha/v1/variants', { token: 'mha_nope' })).status).toBe(401);
    // A user session is not a Home Assistant token, nor the other way around.
    expect((await call('GET', '/ha/v1/variants', { as: 'admin' })).status).toBe(401);
    expect((await call('GET', `/v1/variants/${fx.liter}/history`, { token })).status).toBe(401);
    // Only reads.
    expect((await call('POST', '/ha/v1/variants', { token }, {})).status).toBe(404);
  });

  it('lists every live variant to find its id', async () => {
    const { token } = await newToken();
    const res = (await call('GET', '/ha/v1/variants', { token })).body as HaVariantsResponse;
    expect(res.items).toEqual([
      { variant_id: fx.liter, name: 'Leche Lala Entera · 1 L' },
      { variant_id: fx.six, name: 'Leche Lala Entera · 6 × 1 L' },
    ]);
  });

  it('says the current and lowest prices, stock and links of a variant', async () => {
    const { token } = await newToken();
    const now = Number(fx.now);
    const res = await call('GET', `/ha/v1/variants/${fx.liter}`, { token });
    expect(res.status).toBe(200);
    const v = res.body as HaVariant;
    expect(v).toEqual({
      variant_id: fx.liter,
      name: 'Leche Lala Entera · 1 L',
      display_unit: 'L',
      // Each store's latest of the last 90 days: Walmart $29.00, Amazon $27.00; Soriana has none that recent.
      current: {
        price_cents: 2700,
        display_cents: 2700,
        store: 'Amazon',
        source: 'web',
        observed_at: now - DAY,
      },
      lowest: {
        price_cents: 2400,
        display_cents: 2400,
        store: 'Soriana',
        source: 'shelf',
        observed_at: now - 95 * DAY,
      },
      in_stock: true,
      listings: [{ store: 'Amazon', price_cents: 2700, in_stock: true, status: 'ok', checked_at: now - DAY }],
    });
  });

  it('says nothing it does not know, and 404 or 400 for another id', async () => {
    const { token } = await newToken();
    const six = (await call('GET', `/ha/v1/variants/${fx.six}`, { token })).body as HaVariant;
    expect([six.current, six.lowest, six.in_stock, six.listings]).toEqual([null, null, null, []]);
    expect((await call('GET', `/ha/v1/variants/${uuidv7()}`, { token })).status).toBe(404);
    expect((await call('GET', '/ha/v1/variants/nope', { token })).status).toBe(400);
  });

  it('notes when a token was last used, at most once an hour', async () => {
    const { id, token } = await newToken();
    const used = () =>
      env.DB.prepare('SELECT last_used_at FROM ha_tokens WHERE id = ?1')
        .bind(id)
        .first<{ last_used_at: number | null }>();
    await call('GET', '/ha/v1/variants', { token });
    const first = (await used())!.last_used_at;
    expect(first).toEqual(expect.any(Number));
    await call('GET', '/ha/v1/variants', { token });
    expect((await used())!.last_used_at).toBe(first);
    await env.DB.prepare('UPDATE ha_tokens SET last_used_at = ?1 WHERE id = ?2')
      .bind(first! - 3_600_000, id)
      .run();
    await call('GET', '/ha/v1/variants', { token });
    expect((await used())!.last_used_at).toBeGreaterThanOrEqual(first!);
  });
});
