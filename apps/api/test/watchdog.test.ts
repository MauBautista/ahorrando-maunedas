import { env } from 'cloudflare:workers';
import { uuidv7 } from '@maunedas/shared/util/uuid';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { agentWork, AGENT_OFFLINE_MARK } from '../src/agent/work';
import { sinceText } from '../src/alerts/messages';
import { OFFLINE_ALERT_MS, runWatchdog } from '../src/cron/watchdog';
import type { FcmDeps } from '../src/fcm/send';
import { ADMIN_ID, product, store, syncHarness, variant, type Mutation } from './support/sync';

let h: Awaited<ReturnType<typeof syncHarness>>;
const sent: Array<Record<string, string>> = [];
const deps = (): FcmDeps => ({
  fetch: async (_i, init) => {
    sent.push((JSON.parse(String(init?.body)) as { message: { data: Record<string, string> } }).message.data);
    return Response.json({ name: 'ok' });
  },
  tokens: { get: async () => 'service-token' },
  budget: { left: 40 },
});
const MIN = 60_000;
const work = (at: number) =>
  agentWork(
    env.DB,
    {
      agent_id: 'home',
      agent_version: '1.0.0',
      cursor: [0, ''],
      info: { outbox: 0, due: 0, mem_mb: 500, load1: 0.5, blocked: [], last_error: null },
    } as never,
    at,
  );

beforeAll(async () => {
  h = await syncHarness();
});

beforeEach(async () => {
  await h.reset();
  await env.DB.prepare('DELETE FROM agent_status').run();
  sent.length = 0;
  await env.DB.prepare(
    `INSERT INTO devices (id, user_id, platform, fcm_token, created_at) VALUES (?1, ?2, 'android', 'ok-admin', 1)`,
  )
    .bind(uuidv7(), ADMIN_ID)
    .run();
});

describe('agent watchdog (T-214, 08 §5)', () => {
  it('says nothing of an agent that never connected or is within 2 hours', async () => {
    const now = Date.parse('2026-11-01T18:00:00Z');
    expect(await runWatchdog(env, deps(), now)).toBe(false);
    await work(now - OFFLINE_ALERT_MS + MIN);
    expect(await runWatchdog(env, deps(), now)).toBe(false);
    expect(sent).toEqual([]);
  });

  it('warns the admins once per outage, and again after the agent came back and fell again', async () => {
    const t0 = Date.parse('2026-11-01T18:05:00Z'); // 12:05 p.m. in Mexico City
    await work(t0);
    expect(await runWatchdog(env, deps(), t0 + OFFLINE_ALERT_MS)).toBe(true);
    expect(await runWatchdog(env, deps(), t0 + OFFLINE_ALERT_MS + 60 * MIN)).toBe(false);
    expect(sent).toEqual([
      {
        type: 'system',
        title: 'Servidor casero sin conexión',
        body: 'El tracking de precios está en pausa desde 12:05 p.m.',
        channel: 'system',
      },
    ]);
    // The heartbeat clears the mark (07 §5.1); the next outage is warned again.
    const back = t0 + 5 * OFFLINE_ALERT_MS;
    await work(back);
    expect(
      await env.DB.prepare('SELECT 1 FROM token_cache WHERE key = ?1').bind(AGENT_OFFLINE_MARK).first(),
    ).toBeNull();
    expect(await runWatchdog(env, deps(), back + OFFLINE_ALERT_MS)).toBe(true);
    expect(sent).toHaveLength(2);
  });

  it('writes the time of day, or the day too when it was another day', () => {
    const at = Date.parse('2026-10-31T21:30:00Z'); // 3:30 p.m. Oct 31 in Mexico City
    expect(sinceText(at, at + 60 * MIN)).toBe('3:30 p.m.');
    expect(sinceText(at, at + 24 * 60 * MIN)).toBe('31 oct, 3:30 p.m.');
  });
});

describe('GET /v1/admin/agent (03 §12)', () => {
  const get = async (as: 'admin' | 'member') => {
    const res = await h.app.request(
      '/v1/admin/agent',
      { headers: { Authorization: `Bearer ${h.tokens[as]}`, 'X-Client-Schema': '1' } },
      env as never,
    );
    return { status: res.status, body: await res.json<Record<string, unknown>>() };
  };

  it('is for admins, and says whether the agent is online and what is in trouble', async () => {
    expect((await get('member')).status).toBe(403);
    expect((await get('admin')).body).toEqual({
      status: null,
      online: false,
      blocked_listings: 0,
      failing_listings: 0,
      queued_image_jobs: 0,
    });
    const shop = store({ name: 'Amazon', kind: 'online' });
    const p = product();
    const v = variant(p.row.id);
    expect((await h.push([shop, p, v] as Mutation[], 'admin')).status).toBe(200);
    const listing = (status: string, failures: number, deleted: number | null = null) => {
      const id = uuidv7();
      return [
        env.DB.prepare(
          `INSERT INTO listings (id, variant_id, store_id, adapter, url, deleted_at, created_at, updated_at) VALUES (?1, ?2, ?3, 'amazon_mx', 'https://x.mx', ?4, 1, 1)`,
        ).bind(id, v.row.id, shop.row.id, deleted),
        env.DB.prepare(
          `INSERT INTO listing_state (listing_id, last_status, consecutive_failures, updated_at) VALUES (?1, ?2, ?3, 1)`,
        ).bind(id, status, failures),
      ];
    };
    await env.DB.batch([
      ...listing('blocked', 3),
      ...listing('error', 1),
      ...listing('ok', 0),
      ...listing('blocked', 2, 5),
    ]);
    await work(Date.now() - MIN);
    const { body } = await get('admin');
    expect(body).toMatchObject({
      online: true,
      blocked_listings: 1,
      failing_listings: 2,
      queued_image_jobs: 0,
    });
    expect(body.status).toMatchObject({
      id: 'home',
      agent_version: '1.0.0',
      info: { mem_mb: 500, blocked: [] },
    });
    await env.DB.prepare('UPDATE agent_status SET last_heartbeat_at = ?1')
      .bind(Date.now() - 4 * MIN)
      .run();
    expect((await get('admin')).body.online).toBe(false);
  });
});
