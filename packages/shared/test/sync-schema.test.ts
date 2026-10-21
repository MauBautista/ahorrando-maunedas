import { readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { TABLES, tablesInOrder } from '../src/sync/registry';

/**
 * `sync-schema.json` is the contract Android's Room entities follow (T-102): every table of the sync
 * registry with its mode, order, primary key and the columns that travel, typed as in docs/esquema-d1.sql.
 * Regenerate with `UPDATE_SYNC_SCHEMA=1 pnpm --filter shared test` after a schema change (CLAUDE.md rule 6).
 */
const CONTRACT = new URL('../sync-schema.json', import.meta.url);
const SCHEMA = new URL('../../../docs/esquema-d1.sql', import.meta.url);

interface ColumnInfo {
  name: string;
  type: string;
  notnull: number;
  pk: number;
}

function buildContract() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(SCHEMA, 'utf8'));
  const tables = [...tablesInOrder()].map((name) => {
    const spec = TABLES[name];
    const info = new Map(
      (
        db
          .prepare(`SELECT name, type, "notnull", pk FROM pragma_table_info(?)`)
          .all(name) as unknown as ColumnInfo[]
      ).map((c) => [c.name, c]),
    );
    return {
      name,
      mode: spec.mode,
      order: spec.order,
      pk: spec.pk,
      columns: spec.columns.map((column) => {
        const c = info.get(column);
        if (!c) throw new Error(`${name}.${column} no existe en esquema-d1.sql`);
        return { name: column, type: c.type.toUpperCase(), not_null: c.notnull === 1 || c.pk === 1 };
      }),
    };
  });
  db.close();
  return {
    description:
      'Generated from packages/shared/src/sync/registry.ts and docs/esquema-d1.sql by test/sync-schema.test.ts. Do not edit by hand.',
    tables,
  };
}

describe('sync-schema.json (contract for Room, T-102)', () => {
  it('matches the sync registry and the design schema', () => {
    const contract = buildContract();
    if (process.env.UPDATE_SYNC_SCHEMA === '1')
      writeFileSync(CONTRACT, `${JSON.stringify(contract, null, 2)}\n`);
    expect(JSON.parse(readFileSync(CONTRACT, 'utf8'))).toEqual(contract);
  });
});
