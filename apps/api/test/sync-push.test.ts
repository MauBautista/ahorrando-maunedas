import { env } from 'cloudflare:workers';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ADMIN_ID,
  alertRule,
  alias,
  barcode,
  edit,
  image,
  item,
  MEMBER_ID,
  observation,
  product,
  purchase,
  rendition,
  rowOf,
  store,
  syncHarness,
  syncVersion,
  t,
  variant,
  type PushBody,
} from './support/sync';

let h: Awaited<ReturnType<typeof syncHarness>>;

beforeAll(async () => {
  h = await syncHarness();
});
beforeEach(async () => {
  await h.reset();
});

async function push(...args: Parameters<typeof h.push>) {
  const res = await h.push(...args);
  expect(res.status, await res.clone().text()).toBe(200);
  return res.json<PushBody>();
}

/** A store, product and variant already on the server. */
async function catalog() {
  const s = store();
  const p = product();
  const v = variant(p.row.id);
  await push([s, p, v]);
  return { s, p, v };
}

describe('push · last write wins (04 §8)', () => {
  it('inserts rows, assigns one new version to all of them and stamps updated_by', async () => {
    const s = store({ name: 'Costco' });
    const p = product();
    const body = await push([s, p]);
    expect(body).toEqual({ applied: 2, skipped: 0, conflicts: [] });
    expect(await syncVersion()).toBe(1);
    expect(await rowOf('stores', s.row.id)).toMatchObject({
      name: 'Costco',
      version: 1,
      updated_by: MEMBER_ID,
    });
    expect(await rowOf('products', p.row.id)).toMatchObject({ version: 1, updated_by: MEMBER_ID });
  });

  it('applies an update with a newer updated_at (new version)', async () => {
    const { p } = await catalog();
    const body = await push([edit(p, { name: 'Leche Lala Deslactosada' })]);
    expect(body.applied).toBe(1);
    expect(await rowOf('products', p.row.id)).toMatchObject({ name: 'Leche Lala Deslactosada', version: 2 });
  });

  it('rejects an older update as STALE with the server row', async () => {
    const { p } = await catalog();
    await push([edit(p, { name: 'Nueva' })]);
    const older = { ...p, row: { ...p.row, name: 'Vieja' } };
    const body = await push([older]);
    expect(body).toMatchObject({ applied: 0, skipped: 1 });
    expect(body.conflicts[0]).toMatchObject({
      table: 'products',
      id: p.row.id,
      reason: 'STALE',
      server_row: { name: 'Nueva' },
    });
    expect((await rowOf('products', p.row.id))?.name).toBe('Nueva');
  });

  it('an identical retry is applied without conflict nor new version (lost response)', async () => {
    const { p } = await catalog();
    const before = await syncVersion();
    const body = await push([p]);
    expect(body).toEqual({ applied: 1, skipped: 0, conflicts: [] });
    expect(await syncVersion()).toBe(before);
  });

  it('the same updated_at from another author is STALE', async () => {
    const { p } = await catalog();
    const body = await push([p], 'admin');
    expect(body.conflicts[0]?.reason).toBe('STALE');
  });

  it('clamps updated_at to now + 5 min', async () => {
    const before = Date.now();
    const s = store({ updated_at: before + 365 * 86_400_000 });
    await push([s]);
    const stored = (await rowOf('stores', s.row.id))!.updated_at as number;
    expect(stored).toBeGreaterThanOrEqual(before + 5 * 60_000);
    expect(stored).toBeLessThanOrEqual(Date.now() + 5 * 60_000);
  });

  it('columns absent from the mutation are not erased (04 §3.3)', async () => {
    const p = product({ brand: 'Lala', notes: 'La de siempre' });
    await push([p]);
    const { brand: _b, notes: _n, ...partial } = edit(p, { name: 'Leche Lala Entera 1 L' }).row;
    await push([{ table: 'products', row: partial }]);
    expect(await rowOf('products', p.row.id)).toMatchObject({
      name: 'Leche Lala Entera 1 L',
      brand: 'Lala',
      notes: 'La de siempre',
      // search_key comes from the full row, brand included.
      search_key: 'leche lala entera 1 l lala',
    });
  });

  it('recomputes search_key and trims names', async () => {
    const p = product({ name: '  Café Legal  ', brand: 'Legal', search_key: 'manipulado' });
    await push([p]);
    expect(await rowOf('products', p.row.id)).toMatchObject({
      name: 'Café Legal',
      search_key: 'cafe legal legal',
    });
  });

  it('accepts children before parents in one push (ordered by table, deferred foreign keys)', async () => {
    const s = store();
    const p = product();
    const v = variant(p.row.id);
    const pu = purchase(s.row.id);
    const it1 = item(pu.row.id, v.row.id);
    const body = await push([it1, pu, v, p, s]);
    expect(body).toEqual({ applied: 5, skipped: 0, conflicts: [] });
  });

  it('ignores columns that clients may not write (version, unknown)', async () => {
    const s = store({ version: 999, hacked: true });
    await push([s]);
    expect((await rowOf('stores', s.row.id))?.version).toBe(1);
  });
});

describe('push · validation', () => {
  it('an invalid row → VALIDATION with issues; the rest is applied', async () => {
    const good = store();
    const bad = store({ kind: 'warehouse' });
    const body = await push([good, bad]);
    expect(body).toMatchObject({ applied: 1, skipped: 1 });
    expect(body.conflicts[0]).toMatchObject({ id: bad.row.id, reason: 'VALIDATION' });
    expect(JSON.stringify(body.conflicts[0]?.details)).toContain('kind');
    expect(await rowOf('stores', bad.row.id)).toBeNull();
  });

  it('a row without updated_at or with a bad id → VALIDATION', async () => {
    const { updated_at: _u, ...noTime } = store().row;
    const body = await push([
      { table: 'stores', row: noTime },
      { table: 'stores', row: { ...store().row, id: 'x' } },
    ]);
    expect(body.conflicts.map((c) => c.reason)).toEqual(['VALIDATION', 'VALIDATION']);
  });

  it('an unknown table or a down table → UNKNOWN_TABLE', async () => {
    const body = await push([
      { table: 'users', row: { id: ADMIN_ID, role: 'admin', updated_at: t() } },
      { table: 'secrets', row: { id: 'x' } },
    ]);
    expect(body.conflicts.map((c) => c.reason)).toEqual(['UNKNOWN_TABLE', 'UNKNOWN_TABLE']);
  });

  it('the same row twice in one push: the last occurrence wins', async () => {
    const s = store({ name: 'Primero' });
    const body = await push([s, edit(s, { name: 'Segundo' })]);
    expect(body).toMatchObject({ applied: 1, skipped: 1 });
    expect(body.conflicts[0]?.details).toEqual({ reason: 'DUPLICATE_IN_BATCH' });
    expect((await rowOf('stores', s.row.id))?.name).toBe('Segundo');
  });

  it("a variant's measure cannot change once it has purchases", async () => {
    const { s, v } = await catalog();
    const pu = purchase(s.row.id);
    await push([pu, item(pu.row.id, v.row.id)]);
    const body = await push([edit(v, { measure: 'mass', label: '1 kg' })]);
    expect(body.conflicts[0]).toMatchObject({ reason: 'VALIDATION', details: { reason: 'MEASURE_LOCKED' } });
    // Without purchases it can change.
    const other = variant(String(v.row.product_id));
    await push([other]);
    expect((await push([edit(other, { measure: 'mass', label: '1 kg' })])).applied).toBe(1);
  });
});

describe('push · unique codes (04 §8)', () => {
  it('BARCODE_TAKEN with the variant that owns the code', async () => {
    const { p, v } = await catalog();
    const v2 = variant(p.row.id, { label: '6 × 1 L', pack_count: 6 });
    await push([v2, barcode(v.row.id, '7501020515343')]);
    const mine = barcode(v2.row.id, '7501020515343');
    const body = await push([mine]);
    expect(body.conflicts[0]).toMatchObject({ reason: 'BARCODE_TAKEN', details: { variant_id: v.row.id } });
    expect(await rowOf('barcodes', mine.row.id)).toBeNull();
  });

  it('a tombstoned code does not block; moving a code in the same push is allowed', async () => {
    const { p, v } = await catalog();
    const v2 = variant(p.row.id, { label: '6 × 1 L', pack_count: 6 });
    const old = barcode(v.row.id, '7501020515343');
    await push([v2, old]);
    const body = await push([edit(old, { deleted_at: t() }), barcode(v2.row.id, '7501020515343')]);
    expect(body).toEqual({ applied: 2, skipped: 0, conflicts: [] });
  });

  it('two new rows with the same code in one push: the first claim wins', async () => {
    const { v } = await catalog();
    const body = await push([barcode(v.row.id, '7501020515350'), barcode(v.row.id, '7501020515350')]);
    expect(body).toMatchObject({ applied: 1, skipped: 1 });
    expect(body.conflicts[0]?.reason).toBe('BARCODE_TAKEN');
  });

  it('ALIAS_TAKEN for a legacy alias with another id and the same text', async () => {
    const { s, v } = await catalog();
    await env.DB.prepare(
      `INSERT INTO receipt_aliases (id, store_id, raw_text_norm, variant_id, created_at, updated_at, version)
       VALUES ('0192a5e9-0000-7000-8000-0000000a1a5e', ?1, 'LCH LALA ENT 1L', ?2, 1, 1, 0)`,
    )
      .bind(s.row.id, v.row.id)
      .run();
    const body = await push([alias(s.row.id, v.row.id, 'LCH LALA ENT 1L')]);
    expect(body.conflicts[0]).toMatchObject({
      reason: 'ALIAS_TAKEN',
      server_row: { raw_text_norm: 'LCH LALA ENT 1L' },
    });
  });
});

describe('push · append-only and permissions (04 §8)', () => {
  it('IMMUTABLE_ROW: a rendition only accepts a change of deleted_at', async () => {
    const { p } = await catalog();
    const img = image(p.row.id);
    const r = rendition(img.row.id);
    await push([img, r]);
    expect((await push([edit(r, { width: 512 })])).conflicts[0]?.reason).toBe('IMMUTABLE_ROW');
    expect((await push([edit(r, { deleted_at: t() })])).applied).toBe(1);
  });

  it('FORBIDDEN: a member cannot delete a product; an admin can', async () => {
    const { p } = await catalog();
    const tomb = edit(p, { deleted_at: t() });
    const body = await push([tomb]);
    expect(body.conflicts[0]).toMatchObject({ reason: 'FORBIDDEN', details: { reason: 'ADMIN_DELETE' } });
    expect((await rowOf('products', p.row.id))?.deleted_at).toBeNull();
    expect((await push([edit(tomb)], 'admin')).applied).toBe(1);
  });

  it("FORBIDDEN: someone else's alert rule; user_id is always the signed-in user", async () => {
    const { v } = await catalog();
    const rule = alertRule(v.row.id);
    await push([rule], 'admin');
    expect((await rowOf('alert_rules', rule.row.id))?.user_id).toBe(ADMIN_ID);
    const body = await push([edit(rule, { threshold_cents: 1 })], 'member');
    expect(body.conflicts[0]).toMatchObject({ reason: 'FORBIDDEN', details: { reason: 'NOT_OWNER' } });
  });

  it('FORBIDDEN: clients cannot create web observations nor edit them', async () => {
    const { s, v } = await catalog();
    const web = observation(v.row.id, s.row.id, { source: 'web' });
    expect((await push([web])).conflicts[0]).toMatchObject({
      reason: 'FORBIDDEN',
      details: { reason: 'WEB_OBSERVATION' },
    });
    // A web observation written by the server (agent) cannot be edited by a client either.
    await env.DB.prepare(
      `INSERT INTO price_observations (id, variant_id, store_id, source, price_cents, observed_at, created_at, updated_at, updated_by, version)
       VALUES (?1, ?2, ?3, 'web', 2899, 1, 1, 1, 'agent', 0)`,
    )
      .bind(web.row.id, v.row.id, s.row.id)
      .run();
    expect((await push([edit(web, { source: 'shelf' })])).conflicts[0]?.reason).toBe('FORBIDDEN');
    expect((await push([observation(v.row.id, s.row.id)])).applied).toBe(1);
  });

  it("FORBIDDEN: clients only create 'device' or 'manual' renditions", async () => {
    const { p } = await catalog();
    const img = image(p.row.id);
    await push([img]);
    const body = await push([rendition(img.row.id, { tier: 'home' })]);
    expect(body.conflicts[0]).toMatchObject({ reason: 'FORBIDDEN', details: { reason: 'RENDITION_TIER' } });
  });
});

describe('push · batch and limits', () => {
  it('a missing parent rejects only that row (and its children in the same push)', async () => {
    const s = store();
    const orphan = item('0192a5e9-0000-7000-8000-00000000dead', null);
    const promo = {
      table: 'promotions',
      row: {
        id: '0192a5e9-0000-7000-8000-0000000b0b0b',
        created_at: t(),
        updated_at: t(),
        purchase_id: null,
        purchase_item_id: orphan.row.id,
        observation_id: null,
        type: 'nxm',
      },
    };
    const body = await push([s, orphan, promo]);
    expect(body.applied).toBe(1);
    expect(body.conflicts.map((c) => [c.table, c.reason, c.details])).toEqual([
      [
        'purchase_items',
        'VALIDATION',
        { reason: 'MISSING_PARENT', column: 'purchase_id', table: 'purchases' },
      ],
      [
        'promotions',
        'VALIDATION',
        { reason: 'MISSING_PARENT', column: 'purchase_item_id', table: 'purchase_items' },
      ],
    ]);
    expect(await rowOf('stores', s.row.id)).not.toBeNull();
  });

  it('a tombstoned parent still satisfies the reference', async () => {
    const { s } = await catalog();
    await push([edit(s, { deleted_at: t() })], 'admin');
    expect((await push([purchase(s.row.id)])).applied).toBe(1);
  });

  it('BATCH_REJECTED when D1 still rejects the batch (e.g. a unique race); nothing is written', async () => {
    // Simulates a constraint D1 raises inside the batch after the pre-checks passed.
    await env.DB.prepare(
      `CREATE TRIGGER test_reject_boom BEFORE INSERT ON tags WHEN NEW.name = 'boom'
       BEGIN SELECT RAISE(ABORT, 'UNIQUE constraint failed: tags.name'); END`,
    ).run();
    try {
      const s = store();
      const boom = {
        table: 'tags',
        row: { id: '0192a5e9-0000-7000-8000-00000000b00b', created_at: t(), updated_at: t(), name: 'boom' },
      };
      const res = await h.push([s, boom]);
      expect(res.status).toBe(409);
      expect((await res.json<{ error: { code: string } }>()).error.code).toBe('BATCH_REJECTED');
      expect(await rowOf('stores', s.row.id)).toBeNull();
      expect(await syncVersion()).toBe(0);
    } finally {
      await env.DB.prepare('DROP TRIGGER test_reject_boom').run();
    }
  });

  it('more than 100 mutations → 400 VALIDATION_ERROR', async () => {
    const res = await h.push(Array.from({ length: 101 }, () => store()));
    expect(res.status).toBe(400);
  });

  it('accepts exactly 100 mutations', async () => {
    const body = await push(Array.from({ length: 100 }, () => store()));
    expect(body.applied).toBe(100);
  });

  it('a body over 512 KB → 413 PAYLOAD_TOO_LARGE', async () => {
    const res = await h.push([store({ notes: 'x'.repeat(600 * 1024) })]);
    expect(res.status).toBe(413);
  });

  it('requires X-Client-Schema and a signed-in user', async () => {
    const res = await h.app.request(
      '/v1/sync/push',
      { method: 'POST', headers: { Authorization: `Bearer ${h.tokens.member}` }, body: '{}' },
      env as never,
    );
    expect(res.status).toBe(400);
    const anon = await h.app.request(
      '/v1/sync/push',
      { method: 'POST', headers: { 'X-Client-Schema': '1' } },
      env as never,
    );
    expect(anon.status).toBe(401);
  });
});
