import { env } from 'cloudflare:workers';
import {
  TABLE_NAMES,
  TABLES,
  tablesInOrder,
  USER_COLUMN,
  type TableName,
} from '@maunedas/shared/sync/registry';
import { ROW_SCHEMAS } from '@maunedas/shared/sync/rows';
import { describe, expect, it } from 'vitest';

const db = () => env.DB;
const sorted = (xs: readonly string[]) => [...xs].sort();

async function pragmaColumns(table: string) {
  const { results } = await db()
    .prepare('SELECT name, pk FROM pragma_table_info(?1)')
    .bind(table)
    .all<{ name: string; pk: number }>();
  return results;
}

async function foreignKeys(table: string) {
  const { results } = await db()
    .prepare('SELECT "table" AS ref, "from" AS col, "to" AS target FROM pragma_foreign_key_list(?1)')
    .bind(table)
    .all<{ ref: string; col: string; target: string }>();
  return results;
}

describe('sync registry vs D1 (T-030)', () => {
  it('covers exactly the tables that carry a server version (sync and down)', async () => {
    // D1 forbids PRAGMA on its internal tables, so filter names first and inspect each table.
    const { results } = await db()
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table'
           AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations'`,
      )
      .all<{ name: string }>();
    const versioned: string[] = [];
    for (const { name } of results) {
      if ((await pragmaColumns(name)).some((c) => c.name === 'version')) versioned.push(name);
    }
    expect(sorted(TABLE_NAMES)).toEqual(sorted(versioned));
  });

  it.each(TABLE_NAMES)('%s: pull columns exist in D1 (all of them except for users)', async (name) => {
    const actual = (await pragmaColumns(name)).map((c) => c.name);
    const spec = TABLES[name];
    if (name === 'users') {
      expect(actual).toEqual(expect.arrayContaining([...spec.columns]));
      expect(spec.columns).not.toContain('google_email');
      expect(spec.columns).not.toContain('created_at');
    } else {
      expect(sorted(spec.columns)).toEqual(sorted(actual));
    }
  });

  it.each(TABLE_NAMES)('%s: primary key and writable columns', async (name) => {
    const spec = TABLES[name];
    const pk = (await pragmaColumns(name)).filter((c) => c.pk > 0).map((c) => c.name);
    expect(pk).toEqual([spec.pk]);
    if (spec.mode === 'sync') {
      expect(spec.writable).toBeDefined();
      expect(spec.writable).not.toContain('version');
      expect(sorted(spec.writable ?? [])).toEqual(sorted(spec.columns.filter((c) => c !== 'version')));
    } else {
      expect('writable' in spec).toBe(false);
    }
  });

  it.each(TABLE_NAMES)('%s: every foreign key points to an earlier table (parents first)', async (name) => {
    for (const { ref } of await foreignKeys(name)) {
      if (ref === name) continue; // categories.parent_id
      expect(TABLE_NAMES, `${name} → ${ref}`).toContain(ref);
      expect(TABLES[ref as TableName].order, `${name} → ${ref}`).toBeLessThan(TABLES[name].order);
    }
  });

  it.each(TABLE_NAMES)('%s: refs declare exactly the foreign keys of D1', async (name) => {
    const fks = await foreignKeys(name);
    expect(fks.every((f) => f.target === 'id')).toBe(true);
    const declared = (TABLES[name] as { refs?: Record<string, string> }).refs ?? {};
    expect(declared).toEqual(Object.fromEntries(fks.map((f) => [f.col, f.ref])));
  });

  it('declares the partial unique indexes of the schema', async () => {
    const { results } = await db()
      .prepare(
        `SELECT tbl_name AS t, name, sql FROM sqlite_master WHERE type = 'index' AND sql LIKE 'CREATE UNIQUE INDEX%'`,
      )
      .all<{ t: string; name: string; sql: string }>();
    const declared = TABLE_NAMES.filter((t) => 'uniqueLive' in TABLES[t]);
    expect(sorted(declared)).toEqual(sorted(results.map((r) => r.t).filter((t) => t !== 'users')));
    for (const index of results.filter((r) => declared.includes(r.t as TableName))) {
      const spec = TABLES[index.t as TableName] as { uniqueLive: { columns: readonly string[] } };
      const { results: cols } = await db()
        .prepare('SELECT name FROM pragma_index_info(?1) ORDER BY seqno')
        .bind(index.name)
        .all<{ name: string }>();
      expect(cols.map((c) => c.name)).toEqual([...spec.uniqueLive.columns]);
      expect(index.sql).toMatch(/WHERE\s+deleted_at\s+IS\s+NULL/i);
    }
  });

  it('user-scoped tables have the owner column', async () => {
    for (const name of TABLE_NAMES.filter((t) => TABLES[t].scope === 'user')) {
      expect((await pragmaColumns(name)).map((c) => c.name)).toContain(USER_COLUMN);
    }
  });

  it.each(TABLE_NAMES)('%s: the Zod row schema has exactly the columns that travel', (name) => {
    const spec = TABLES[name];
    const expected = spec.mode === 'sync' ? spec.writable : spec.columns;
    expect(sorted(Object.keys(ROW_SCHEMAS[name].shape))).toEqual(sorted(expected ?? []));
  });

  it('orders parents before children', () => {
    const order = tablesInOrder();
    expect(order.indexOf('stores')).toBeLessThan(order.indexOf('purchases'));
    expect(order.indexOf('purchases')).toBeLessThan(order.indexOf('purchase_items'));
    expect(order.indexOf('purchase_items')).toBeLessThan(order.indexOf('promotions'));
    expect(order.at(-1)).toBe('promotions');
  });
});
