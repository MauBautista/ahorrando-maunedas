import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { getTableConfig, getViewConfig } from 'drizzle-orm/sqlite-core';
import { beforeAll, describe, expect, it } from 'vitest';
import { TABLES, vPricePoints } from '../src/db/schema';

const INTERNAL = /^(sqlite_|_cf_|d1_migrations$)/;

interface MasterRow {
  type: string;
  name: string;
  tbl_name: string;
  sql: string | null;
}

interface ColumnInfo {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

/** Comments and whitespace do not count; everything else in the stored DDL must match. */
const normalize = (sql: string | null) =>
  sql === null
    ? null
    : sql
        .replace(/--[^\n]*/g, '')
        .replace(/\s+/g, ' ')
        .replace(/\s*([(),])\s*/g, '$1')
        .trim();

async function schemaObjects(db: D1Database) {
  const { results } = await db
    .prepare('SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name')
    .all<MasterRow>();
  return results.filter((r) => !INTERNAL.test(r.name)).map((r) => ({ ...r, sql: normalize(r.sql) }));
}

async function columns(db: D1Database, table: string) {
  const { results } = await db.prepare(`SELECT * FROM pragma_table_info(?1)`).bind(table).all<ColumnInfo>();
  return results;
}

beforeAll(async () => {
  await applyD1Migrations(env.REFERENCE_DB, env.REFERENCE_SCHEMA);
});

describe('migrations', () => {
  it('produce exactly the design schema of docs/esquema-d1.sql', async () => {
    const migrated = await schemaObjects(env.DB);
    expect(migrated.length).toBeGreaterThan(0);
    expect(migrated).toEqual(await schemaObjects(env.REFERENCE_DB));
  });

  it('create 29 tables, the price view and the partial unique indexes', async () => {
    const objects = await schemaObjects(env.DB);
    expect(objects.filter((o) => o.type === 'table')).toHaveLength(29);
    expect(objects.filter((o) => o.type === 'view').map((o) => o.name)).toEqual(['v_price_points']);
    expect(objects.find((o) => o.name === 'uq_barcodes_code_live')?.sql).toContain(
      'WHERE deleted_at IS NULL',
    );
    expect(objects.find((o) => o.name === 'uq_receipt_aliases_live')?.sql).toContain(
      'WHERE deleted_at IS NULL',
    );
  });

  it('keep usernames, Google e-mails and tag names case-insensitive', async () => {
    const users = (await schemaObjects(env.DB)).find((o) => o.name === 'users')?.sql ?? '';
    expect(users).toContain('username TEXT NOT NULL UNIQUE COLLATE NOCASE');
    expect(users).toContain('google_email TEXT UNIQUE COLLATE NOCASE');
    const tags = (await schemaObjects(env.DB)).find((o) => o.name === 'tags')?.sql ?? '';
    expect(tags).toContain('name TEXT NOT NULL COLLATE NOCASE');
  });
});

describe('Drizzle schema', () => {
  it('declares every table of the database', async () => {
    const tables = (await schemaObjects(env.DB)).filter((o) => o.type === 'table').map((o) => o.name);
    expect(Object.keys(TABLES).sort()).toEqual(tables.sort());
  });

  it.each(Object.entries(TABLES))('%s matches PRAGMA table_info', async (name, table) => {
    const actual = (await columns(env.DB, name)).map((c) => ({
      name: c.name,
      type: c.type.toLowerCase(),
      primary: c.pk > 0,
      // SQLite allows NULL in non-INTEGER primary keys; Drizzle marks them NOT NULL anyway.
      notNull: c.pk > 0 ? true : c.notnull === 1,
      hasDefault: c.dflt_value !== null,
    }));
    const declared = getTableConfig(table).columns.map((c) => ({
      name: c.name,
      type: c.getSQLType(),
      primary: c.primary,
      notNull: c.primary ? true : c.notNull,
      hasDefault: c.hasDefault,
    }));
    expect(declared).toEqual(actual);
  });

  it('declares the columns of v_price_points', async () => {
    const actual = (await columns(env.DB, 'v_price_points')).map((c) => c.name);
    expect(Object.keys(getViewConfig(vPricePoints).selectedFields)).toEqual(actual);
  });
});

describe('v_price_points', () => {
  it('prorates ticket-level discounts over the live lines (RF-COM-05)', async () => {
    const db = env.REFERENCE_DB;
    await db.batch([
      db.prepare(
        `INSERT INTO stores (id, name, kind, created_at, updated_at) VALUES ('s', 'Walmart', 'both', 0, 0)`,
      ),
      db.prepare(`INSERT INTO products (id, name, created_at, updated_at) VALUES ('p', 'Leche', 0, 0)`),
      db.prepare(
        `INSERT INTO variants (id, product_id, label, measure, unit_amount, pack_count, created_at, updated_at)
         VALUES ('v1', 'p', '1 L', 'volume', 1000, 1, 0, 0), ('v6', 'p', '6 × 1 L', 'volume', 1000, 6, 0, 0)`,
      ),
      // $20.00 coupon over $200.00 of live lines → every line is paid at 90 %.
      db.prepare(
        `INSERT INTO purchases (id, store_id, purchased_at, discount_cents, source, status, created_at, updated_at)
         VALUES ('c1', 's', 1, 2000, 'manual', 'confirmed', 0, 0), ('c2', 's', 2, 0, 'manual', 'confirmed', 0, 0)`,
      ),
      db.prepare(
        `INSERT INTO purchase_items (id, purchase_id, line_no, variant_id, quantity, unit_price_cents, gross_cents,
                                     discount_cents, final_cents, created_at, updated_at, deleted_at)
         VALUES ('i1', 'c1', 1, 'v1', 2, 2500, 5000, 0, 5000, 0, 0, NULL),
                ('i2', 'c1', 2, 'v6', 1, 15000, 15000, 0, 15000, 0, 0, NULL),
                ('i3', 'c1', 3, NULL, 1, 999, 999, 0, 999, 0, 0, 5),
                ('i4', 'c2', 1, 'v1', 1, 2850, 2850, 0, 2850, 0, 0, NULL)`,
      ),
    ]);
    const { results } = await db
      .prepare(
        `SELECT point_id, effective_unit_cents, round(cents_per_base, 6) AS cpb, has_promo
         FROM v_price_points ORDER BY point_id`,
      )
      .all();
    expect(results).toEqual([
      { point_id: 'i1', effective_unit_cents: 2250, cpb: 2.25, has_promo: 1 },
      { point_id: 'i2', effective_unit_cents: 13500, cpb: 2.25, has_promo: 1 },
      { point_id: 'i4', effective_unit_cents: 2850, cpb: 2.85, has_promo: 0 },
    ]);
  });
});
