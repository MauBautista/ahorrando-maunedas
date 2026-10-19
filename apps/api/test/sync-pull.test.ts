import { env } from 'cloudflare:workers';
import { tablesInOrder } from '@maunedas/shared/sync/registry';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ADMIN_ID,
  alertRule,
  edit,
  MEMBER_ID,
  product,
  store,
  syncHarness,
  t,
  variant,
  type PullBody,
  type PushBody,
} from './support/sync';

let h: Awaited<ReturnType<typeof syncHarness>>;

beforeAll(async () => {
  h = await syncHarness();
});
beforeEach(async () => {
  await h.reset();
});

async function pull(body: Record<string, unknown> = {}, as: 'admin' | 'member' = 'member') {
  const res = await h.pull(body, as);
  expect(res.status, await res.clone().text()).toBe(200);
  return res.json<PullBody>();
}

async function push(...args: Parameters<typeof h.push>) {
  const res = await h.push(...args);
  expect(res.status).toBe(200);
  return res.json<PushBody>();
}

/** Pulls page after page with the returned cursors until has_more is false. */
async function pullAll(as: 'admin' | 'member' = 'member', limit?: number) {
  const pages: PullBody[] = [];
  let cursors: Record<string, [number, string]> = {};
  for (let i = 0; i < 20; i++) {
    const page = await pull({ cursors, ...(limit ? { limit } : {}) }, as);
    pages.push(page);
    cursors = page.cursors;
    if (!page.has_more) break;
  }
  return pages;
}

describe('pull (04 §4)', () => {
  it('from scratch returns every table with rows, parents first, with versions and server info', async () => {
    const s = store();
    const p = product();
    await push([s, p, variant(p.row.id)]);
    const body = await pull();
    expect(Object.keys(body.changes)).toEqual(['users', 'stores', 'products', 'variants']);
    expect(body.changes.stores?.[0]).toMatchObject({ id: s.row.id, version: 1 });
    expect(body.has_more).toBe(false);
    expect(body.schema_version).toBe(1);
    expect(Math.abs(body.server_time - Date.now())).toBeLessThan(60_000);
    // A cursor for every table, even the empty ones.
    expect(Object.keys(body.cursors).sort()).toEqual([...tablesInOrder()].sort());
    expect(body.cursors.stores).toEqual([1, s.row.id]);
    expect(body.cursors.tags).toEqual([0, '']);
  });

  it('with the returned cursors there is nothing new; later edits arrive with their new version', async () => {
    const s = store();
    await push([s]);
    const first = await pull();
    const second = await pull({ cursors: first.cursors });
    expect(second.changes).toEqual({});
    expect(second.cursors).toEqual(first.cursors);

    await push([edit(s, { name: 'Costco Puebla' })]);
    const third = await pull({ cursors: first.cursors });
    expect(third.changes.stores).toEqual([
      expect.objectContaining({ id: s.row.id, name: 'Costco Puebla', version: 2 }),
    ]);
  });

  it('tombstones travel so clients apply deletions', async () => {
    const s = store();
    await push([s]);
    await push([edit(s, { deleted_at: t() })], 'admin');
    const body = await pull({ tables: ['stores'] });
    expect(body.changes.stores?.[0]?.deleted_at).toEqual(expect.any(Number));
  });

  it('1,200 rows of the same version are paged without skipping or repeating (compound cursor)', async () => {
    await env.DB.prepare(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 1200)
       INSERT INTO tags (id, name, created_at, updated_at, version)
       SELECT printf('0192a5e9-0000-7000-8000-%012d', i), 'etiqueta ' || i, 1, 1, 7 FROM n`,
    ).run();
    const pages = await pullAll('member', 500);
    expect(pages.map((p) => p.changes.tags?.length ?? 0)).toEqual([500, 500, 200]);
    expect(pages.map((p) => p.has_more)).toEqual([true, true, false]);
    const ids = pages.flatMap((p) => (p.changes.tags ?? []).map((r) => r.id));
    expect(new Set(ids).size).toBe(1200);
    expect(pages[0]!.cursors.tags).toEqual([7, '0192a5e9-0000-7000-8000-000000000500']);
  });

  it('without limit, pages hold 100 rows per table (spike D, decision T40)', async () => {
    await env.DB.prepare(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 150)
       INSERT INTO tags (id, name, created_at, updated_at, version)
       SELECT printf('0192a5e9-0000-7000-8000-%012d', i), 'etiqueta ' || i, 1, 1, 3 FROM n`,
    ).run();
    const first = await pull({ tables: ['tags'] });
    expect(first.changes.tags).toHaveLength(100);
    expect(first.has_more).toBe(true);
    const second = await pull({ tables: ['tags'], cursors: first.cursors });
    expect(second.changes.tags).toHaveLength(50);
    expect(second.has_more).toBe(false);
  });

  it('a row edited between pages is delivered again at its new version, never lost', async () => {
    const rows = Array.from({ length: 6 }, () => store());
    await push(rows);
    const page1 = await pull({ limit: 3, tables: ['stores'] });
    await push([edit(rows[0]!, { name: 'Editada' }), edit(rows[5]!, { name: 'También' })]);
    const rest = await pull({ cursors: page1.cursors, tables: ['stores'] });
    const names = Object.fromEntries((rest.changes.stores ?? []).map((r) => [r.id, r.name]));
    expect(names[rows[0]!.row.id]).toBe('Editada');
    expect(names[rows[5]!.row.id]).toBe('También');
    const seen = new Set([...(page1.changes.stores ?? []), ...(rest.changes.stores ?? [])].map((r) => r.id));
    expect(seen.size).toBe(6);
  });

  it('alert rules and alert events are filtered by user', async () => {
    const p = product();
    const v = variant(p.row.id);
    await push([p, v]);
    const mine = alertRule(v.row.id);
    const theirs = alertRule(v.row.id);
    await push([mine], 'member');
    await push([theirs], 'admin');
    await env.DB.batch(
      [
        ['0192a5e9-0000-7000-8000-0000000e0001', mine.row.id, MEMBER_ID],
        ['0192a5e9-0000-7000-8000-0000000e0002', theirs.row.id, ADMIN_ID],
      ].map(([id, rule, user]) =>
        env.DB.prepare(
          `INSERT INTO alert_events (id, rule_id, user_id, fired_at, title, body, delivery_status, version)
           VALUES (?1, ?2, ?3, 1, 'Bajó', 'En Amazon', 'sent', 9)`,
        ).bind(id, rule, user),
      ),
    );
    const member = await pull();
    expect(member.changes.alert_rules?.map((r) => r.id)).toEqual([mine.row.id]);
    expect(member.changes.alert_events?.map((r) => r.user_id)).toEqual([MEMBER_ID]);
    const admin = await pull({}, 'admin');
    expect(admin.changes.alert_rules?.map((r) => r.id)).toEqual([theirs.row.id]);
  });

  it('users only expose the columns of the registry (never google_email)', async () => {
    await env.DB.prepare(`UPDATE users SET google_email = 'mau@gmail.com' WHERE id = ?1`)
      .bind(ADMIN_ID)
      .run();
    const body = await pull({ tables: ['users'] });
    for (const u of body.changes.users ?? []) {
      expect(Object.keys(u).sort()).toEqual([
        'active',
        'display_name',
        'id',
        'role',
        'updated_at',
        'username',
        'version',
      ]);
    }
  });

  it('`tables` limits the response to those tables', async () => {
    await push([store(), product()]);
    const body = await pull({ tables: ['products'] });
    expect(Object.keys(body.changes)).toEqual(['products']);
    expect(Object.keys(body.cursors)).toEqual(['products']);
  });

  it.each([
    ['unknown table', { tables: ['secrets'] }],
    ['unknown cursor table', { cursors: { secrets: [0, ''] } }],
    ['limit 0', { limit: 0 }],
    ['limit 501', { limit: 501 }],
    ['bad cursor', { cursors: { stores: ['1', 'x'] } }],
    ['negative version', { cursors: { stores: [-1, ''] } }],
  ])('%s → 400 VALIDATION_ERROR', async (_case, body) => {
    const res = await h.pull(body);
    expect(res.status).toBe(400);
    expect((await res.json<{ error: { code: string } }>()).error.code).toBe('VALIDATION_ERROR');
  });
});
