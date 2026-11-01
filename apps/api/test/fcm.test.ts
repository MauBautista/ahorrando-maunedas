import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { uuidv7 } from '@maunedas/shared/util/uuid';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { notifySoftLimit } from '../src/alerts/system';
import { notifyAdmins, sendToUser } from '../src/fcm/deliver';
import { type FcmDeps, sendFcm } from '../src/fcm/send';
import { ADMIN_ID, MEMBER_ID, product, store, syncHarness, variant, type Mutation } from './support/sync';

interface Sent {
  url: string;
  auth: string | null;
  body: { message: { token: string; data: Record<string, string>; android: unknown } };
}

/** FCM as Firebase answers it: tokens starting with "gone" are unregistered, "bad" fail. */
function fakeFcm() {
  const sent: Sent[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const body = JSON.parse(String(init?.body)) as Sent['body'];
    sent.push({ url: String(input), auth: new Headers(init?.headers).get('Authorization'), body });
    const token = body.message.token;
    if (token.startsWith('gone-404')) return new Response('{}', { status: 404 });
    if (token.startsWith('gone'))
      return Response.json({ error: { details: [{ errorCode: 'UNREGISTERED' }] } }, { status: 400 });
    if (token.startsWith('bad')) return new Response('{}', { status: 500 });
    return Response.json({ name: 'projects/x/messages/1' });
  };
  return { sent, fetchImpl, tokens: { get: async () => 'service-token' } };
}

const deps = (f: ReturnType<typeof fakeFcm>, left = 40): FcmDeps => ({
  fetch: f.fetchImpl,
  tokens: f.tokens,
  budget: { left },
});
let h: Awaited<ReturnType<typeof syncHarness>>;
let fcm: ReturnType<typeof fakeFcm>;

beforeAll(async () => {
  fcm = fakeFcm();
  h = await syncHarness({ fetch: fcm.fetchImpl, googleTokens: fcm.tokens });
});

const device = (user: string, token: string | null) =>
  env.DB.prepare(
    `INSERT INTO devices (id, user_id, platform, fcm_token, created_at) VALUES (?1, ?2, 'android', ?3, 1)`,
  )
    .bind(uuidv7(), user, token)
    .run();
const tokensOf = (user: string) =>
  env.DB.prepare('SELECT fcm_token FROM devices WHERE user_id = ?1 ORDER BY id')
    .bind(user)
    .all<{ fcm_token: string | null }>()
    .then((r) => r.results.map((d) => d.fcm_token));

beforeEach(async () => {
  await h.reset();
  fcm.sent.length = 0;
});

describe('FCM delivery (08 §6)', () => {
  it('sends a data-only, high-priority message with the service token', async () => {
    expect(await sendFcm(env, deps(fcm), 'ok-1', { type: 'price_alert', title: 'T' })).toBe('sent');
    expect(fcm.sent).toEqual([
      {
        url: `https://fcm.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/messages:send`,
        auth: 'Bearer service-token',
        body: {
          message: {
            token: 'ok-1',
            data: { type: 'price_alert', title: 'T' },
            android: { priority: 'HIGH', ttl: '86400s' },
          },
        },
      },
    ]);
    expect(await sendFcm(env, deps(fcm), 'gone-404', {})).toBe('unregistered');
    expect(await sendFcm(env, deps(fcm), 'gone-400', {})).toBe('unregistered');
    expect(await sendFcm(env, deps(fcm), 'bad-1', {})).toBe('failed');
  });

  it('is sent, partial, failed or no_devices, and forgets unregistered tokens (case 12)', async () => {
    expect(await sendToUser(env, deps(fcm), MEMBER_ID, {})).toBe('no_devices');
    await device(MEMBER_ID, 'gone-1');
    expect(await sendToUser(env, deps(fcm), MEMBER_ID, {})).toBe('failed');
    expect(await tokensOf(MEMBER_ID)).toEqual([null]);
    await device(MEMBER_ID, 'ok-1');
    await device(MEMBER_ID, 'gone-2');
    expect(await sendToUser(env, deps(fcm), MEMBER_ID, {})).toBe('partial');
    expect(await tokensOf(MEMBER_ID)).toEqual([null, 'ok-1', null]);
    expect(await sendToUser(env, deps(fcm), MEMBER_ID, {})).toBe('sent');
    // A failure keeps the token: it may work next time.
    await device(MEMBER_ID, 'bad-1');
    expect(await sendToUser(env, deps(fcm), MEMBER_ID, {})).toBe('partial');
    expect((await tokensOf(MEMBER_ID)).filter(Boolean)).toEqual(['ok-1', 'bad-1']);
  });

  it('stops sending when the invocation’s budget is spent', async () => {
    await device(MEMBER_ID, 'ok-1');
    await device(MEMBER_ID, 'ok-2');
    expect(await sendToUser(env, deps(fcm, 1), MEMBER_ID, {})).toBe('partial');
    expect(fcm.sent).toHaveLength(1);
  });

  it('sends system notices to active admins only, with the system channel', async () => {
    await device(ADMIN_ID, 'ok-admin');
    await device(MEMBER_ID, 'ok-member');
    await notifyAdmins(env, deps(fcm), 'Título', 'Cuerpo');
    expect(fcm.sent.map((s) => [s.body.message.token, s.body.message.data])).toEqual([
      ['ok-admin', { type: 'system', title: 'Título', body: 'Cuerpo', channel: 'system' }],
    ]);
  });
});

describe('notices and alerts through the agent (08 §5)', () => {
  it('tells the admins a store started blocking and delivers the price alert', async () => {
    const shop = store({ name: 'Amazon', kind: 'online' });
    const p = product({ name: 'Leche Lala Entera', display_unit: 'L' });
    const v = variant(p.row.id, { label: '1 L', unit_amount: 1000 });
    expect((await h.push([shop, p, v] as Mutation[], 'admin')).status).toBe(200);
    const listing = uuidv7();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO listings (id, variant_id, store_id, adapter, url, created_at, updated_at, version)
         VALUES (?1, ?2, ?3, 'amazon_mx', 'https://www.amazon.com.mx/dp/B000000001', 1, 1, 1)`,
      ).bind(listing, v.row.id, shop.row.id),
      env.DB.prepare(
        `INSERT INTO alert_rules (id, user_id, variant_id, type, threshold_cents, scope, cooldown_hours, active, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'below_price', 3000, 'variant_web', 24, 1, 1, 1)`,
      ).bind(uuidv7(), MEMBER_ID, v.row.id),
    ]);
    await device(ADMIN_ID, 'ok-admin');
    await device(MEMBER_ID, 'ok-member');
    const now = Date.now();
    const post = async (result: Record<string, unknown>) => {
      const ctx = createExecutionContext();
      const res = await h.app.request(
        '/agent/v1/observations',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-agent-token' },
          body: JSON.stringify({ results: [{ listing_id: listing, price_cents: null, ...result }] }),
        },
        env as never,
        ctx,
      );
      expect(res.status).toBe(200);
      await waitOnExecutionContext(ctx);
    };
    await post({ checked_at: now - 2 * 3_600_000, status: 'blocked', error: 'captcha' });
    expect(fcm.sent.map((s) => s.body.message.data)).toEqual([
      {
        type: 'system',
        title: 'Tienda bloqueando revisiones',
        body: 'Amazon bloqueó la revisión de Leche Lala Entera · 1 L. Se reintentará más tarde.',
        channel: 'system',
      },
    ]);
    fcm.sent.length = 0;
    await post({ checked_at: now - 3_600_000, status: 'ok', price_cents: 2900, in_stock: true });
    expect(fcm.sent.map((s) => [s.body.message.token, s.body.message.data.title])).toEqual([
      ['ok-member', 'Leche Lala Entera · 1 L bajó a $29.00'],
    ]);
    const events = await env.DB.prepare('SELECT delivery_status FROM alert_events').all();
    expect(events.results).toEqual([{ delivery_status: 'sent' }]);
  });

  it('tells the admins once a month that AI spending crossed the soft limit', async () => {
    await device(ADMIN_ID, 'ok-admin');
    const now = Date.UTC(2026, 9, 15, 18);
    expect(await notifySoftLimit(env, deps(fcm), now)).toBe(false);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO ai_usage (id, purpose, provider, model, cost_usd_micros, created_at) VALUES (?1, 'receipt', 'openrouter', 'm', 4100000, ?2)`,
      ).bind(uuidv7(), now - 3_600_000),
      env.DB.prepare(
        `INSERT INTO token_cache (key, value, expires_at) VALUES ('ai_soft:2026-10', '1', ?1)`,
      ).bind(now + 30 * 86_400_000),
    ]);
    expect(await notifySoftLimit(env, deps(fcm), now)).toBe(true);
    expect(await notifySoftLimit(env, deps(fcm), now + 3_600_000)).toBe(false);
    expect(fcm.sent.map((s) => s.body.message.data)).toEqual([
      {
        type: 'system',
        title: 'Gasto de IA al 82 %',
        body: 'Llevas 4.10 de 5 USD este mes.',
        channel: 'system',
      },
    ]);
  });
});
