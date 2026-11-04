import { env } from 'cloudflare:workers';
import type { BackupPullResponse } from '@maunedas/shared/api/agent';
import { tablesInOrder } from '@maunedas/shared/sync/registry';
import { uuidv7 } from '@maunedas/shared/util/uuid';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ADMIN_ID,
  alertRule,
  edit,
  MEMBER_ID,
  product,
  purchase,
  store,
  syncHarness,
  variant,
  type Mutation,
} from './support/sync';

type Answer = BackupPullResponse & {
  error?: { code: string; details?: { issues: Array<{ message: string }> } };
};

let h: Awaited<ReturnType<typeof syncHarness>>;

beforeAll(async () => {
  h = await syncHarness();
});

async function backup(body: unknown, token: string | null = 'test-agent-token') {
  const res = await h.app.request(
    '/agent/v1/backup/pull',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    },
    env as never,
  );
  return { status: res.status, body: await res.json<Answer>() };
}

/** Every page until `has_more` is false, as the mirror does. */
async function all(limit: number) {
  const rows: Record<string, Array<Record<string, unknown>>> = {};
  let cursors: Record<string, [number, string]> = {};
  let pages = 0;
  for (;;) {
    const { status, body } = await backup({ cursors, limit });
    expect(status).toBe(200);
    pages += 1;
    for (const [table, list] of Object.entries(body.changes)) {
      rows[table] = body.replace.includes(table) ? list : [...(rows[table] ?? []), ...list];
    }
    cursors = body.cursors;
    if (!body.has_more) return { rows, pages, cursors };
  }
}

const aiUsage = (id: string, createdAt: number) =>
  env.DB.prepare(
    `INSERT INTO ai_usage (id, purpose, provider, model, user_id, cost_usd_micros, created_at)
     VALUES (?1, 'receipt', 'openrouter', 'm', ?2, 1200, ?3)`,
  ).bind(id, MEMBER_ID, createdAt);

let fx: { rule: Mutation; other: Mutation };

beforeEach(async () => {
  await h.reset();
  const shop = store({ name: 'Costco' });
  const p = product();
  const v = variant(p.row.id);
  const rule = alertRule(v.row.id);
  const other = alertRule(v.row.id);
  const bought = purchase(shop.row.id as string, { source: 'cfdi' });
  expect((await h.push([shop, p, v, rule, bought], 'member')).status).toBe(200);
  expect((await h.push([other], 'admin')).status).toBe(200);
  // A tombstone travels too.
  expect((await h.push([edit(other, { deleted_at: Date.now() })], 'admin')).status).toBe(200);
  await env.DB.batch([
    env.DB.prepare(`UPDATE users SET google_email = 'mau@example.com' WHERE id = ?1`).bind(ADMIN_ID),
    aiUsage('0192a000-0000-7000-8000-0000000000a1', 5),
    aiUsage('0192a000-0000-7000-8000-0000000000a2', 5),
    aiUsage('0192a000-0000-7000-8000-0000000000a3', 7),
    env.DB.prepare(
      `INSERT INTO receipt_extractions (id, image_ids, images_key, requested_by, provider, model, status, created_at)
       VALUES (?1, '[]', 'k', ?2, 'openrouter', 'm', 'failed', 9)`,
    ).bind(uuidv7(), MEMBER_ID),
    env.DB.prepare(`INSERT INTO token_cache (key, value, expires_at) VALUES ('google', 'secret', 1)`),
    // An imported invoice is kept (T-307); a Home Assistant token is not (T-308).
    env.DB.prepare(
      `INSERT INTO cfdi_imports (id, fiscal_uuid, purchase_id, store_id, emisor_rfc, created_by, created_at)
       VALUES (?1, 'UUID-FISCAL', ?2, ?3, 'CME910715UB9', ?4, 11)`,
    ).bind(uuidv7(), bought.row.id, shop.row.id, MEMBER_ID),
    env.DB.prepare(
      `INSERT INTO ha_tokens (id, name, token_sha256, created_by, created_at) VALUES (?1, 'Casa', 'h', ?2, 1)`,
    ).bind(uuidv7(), ADMIN_ID),
    env.DB.prepare(
      `INSERT INTO devices (id, user_id, platform, fcm_token, created_at) VALUES (?1, ?2, 'android', 'fcm', 1)`,
    ).bind(uuidv7(), MEMBER_ID),
  ]);
  fx = { rule, other };
});

describe('POST /agent/v1/backup/pull (07 §5.4)', () => {
  it('only answers the agent', async () => {
    expect((await backup({}, null)).status).toBe(401);
    expect((await backup({}, 'other-token')).status).toBe(401);
    expect((await backup({}, h.tokens.admin)).status).toBe(401);
  });

  it('takes every user, every column and tombstones; leaves caches, devices and jobs out', async () => {
    const { status, body } = await backup({});
    expect(status).toBe(200);
    const users = body.changes.users!;
    expect(users.find((u) => u.id === ADMIN_ID)).toMatchObject({ google_email: 'mau@example.com' });
    expect(users[0]).toHaveProperty('created_at');
    // Both users' alert rules, the deleted one included.
    const rules = body.changes.alert_rules!;
    expect(rules.map((r) => r.id).sort()).toEqual([fx.rule.row.id, fx.other.row.id].sort());
    expect(rules.find((r) => r.id === fx.other.row.id)!.deleted_at).toEqual(expect.any(Number));
    expect(body.changes.ai_usage).toHaveLength(3);
    expect(body.changes.receipt_extractions).toHaveLength(1);
    expect(body.changes.user_identities!.map((r) => r.firebase_uid).sort()).toEqual([
      'uid-admin',
      'uid-member',
    ]);
    expect(body.replace).toEqual(['user_identities']);
    for (const t of ['token_cache', 'devices', 'image_jobs', 'off_cache', 'sync_meta', 'ha_tokens']) {
      expect(body.changes).not.toHaveProperty(t);
      expect(body.cursors).not.toHaveProperty(t);
    }
    expect(Object.keys(body.cursors).sort()).toEqual(
      [...tablesInOrder(), 'ai_usage', 'receipt_extractions', 'cfdi_imports'].sort(),
    );
    expect(body.has_more).toBe(false);
    expect(body.schema_version).toBeGreaterThan(0);
    // Parents first, as a restore applies them.
    const order = Object.keys(body.changes);
    expect(order.indexOf('users')).toBeLessThan(order.indexOf('alert_rules'));
    expect(order.at(-1)).toBe('user_identities');
  });

  it('pages until every row of D1 is in the mirror (RF-BAK-01)', async () => {
    const { rows, pages } = await all(1);
    expect(pages).toBeGreaterThan(2);
    for (const table of [
      ...tablesInOrder(),
      'ai_usage',
      'receipt_extractions',
      'cfdi_imports',
      'user_identities',
    ]) {
      const count = Number(await env.DB.prepare(`SELECT count(*) AS n FROM ${table}`).first('n'));
      expect([table, rows[table]?.length ?? 0]).toEqual([table, count]);
    }
  });

  it('reads server rows by (created_at, id) and edited rows again by their new version', async () => {
    const first = await backup({ tables: ['ai_usage'], limit: 2 });
    expect(first.body.changes.ai_usage!.map((r) => r.id)).toEqual([
      '0192a000-0000-7000-8000-0000000000a1',
      '0192a000-0000-7000-8000-0000000000a2',
    ]);
    expect(first.body.cursors).toEqual({ ai_usage: [5, '0192a000-0000-7000-8000-0000000000a2'] });
    expect(first.body.has_more).toBe(true);
    const next = await backup({ tables: ['ai_usage'], cursors: first.body.cursors, limit: 2 });
    expect(next.body.changes.ai_usage!.map((r) => r.id)).toEqual(['0192a000-0000-7000-8000-0000000000a3']);
    expect(next.body.has_more).toBe(false);
    const done = await backup({ tables: ['ai_usage'], cursors: next.body.cursors });
    expect(done.body.changes).toEqual({});
    expect(done.body.cursors).toEqual(next.body.cursors);

    const { cursors } = await all(100);
    expect((await h.push([edit(fx.rule, { threshold_cents: 1234 })], 'member')).status).toBe(200);
    const again = await backup({ cursors });
    expect(again.body.changes.alert_rules!.map((r) => r.id)).toEqual([fx.rule.row.id]);
    expect(again.body.changes.alert_rules![0]!.threshold_cents).toBe(1234);
  });

  it('sends logins whole, so a removed one leaves the mirror too', async () => {
    await env.DB.prepare(`DELETE FROM user_identities WHERE firebase_uid = 'uid-member'`).run();
    const one = await backup({ tables: ['user_identities'] });
    expect(one.body.changes.user_identities!.map((r) => r.firebase_uid)).toEqual(['uid-admin']);
    expect(one.body.cursors).toEqual({});
    await env.DB.prepare(`DELETE FROM user_identities`).run();
    const none = await backup({ tables: ['user_identities'] });
    expect(none.body.changes).toEqual({ user_identities: [] });
    expect(none.body.replace).toEqual(['user_identities']);
  });

  it('refuses unknown tables and cursors for whole tables', async () => {
    for (const body of [
      { tables: ['token_cache'] },
      { tables: ['nope'] },
      { cursors: { devices: [0, ''] } },
      { cursors: { user_identities: [0, ''] } },
    ]) {
      const res = await backup(body);
      expect([res.status, res.body.error?.code]).toEqual([400, 'VALIDATION_ERROR']);
    }
    expect((await backup({ limit: 501 })).status).toBe(400);
    expect((await backup({ extra: 1 })).status).toBe(400);
  });
});
