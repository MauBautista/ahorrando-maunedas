import type { Row, TableSpec } from '@maunedas/shared/sync/registry';

/**
 * Upsert of the columns present in `row` only (04 §3.3), so a client on an older schema never erases
 * columns it does not know. Table and column names come from the registry whitelist (no injection).
 * `version` is the value `sync_meta` holds inside the same batch; the WHERE keeps last-write-wins even
 * when two pushes race.
 */
export function buildUpsert(db: D1Database, table: string, spec: TableSpec, row: Row): D1PreparedStatement {
  const cols = (spec.writable ?? []).filter((c) => c in row);
  const placeholders = cols.map((_, i) => `?${i + 1}`);
  const updates = cols
    .filter((c) => c !== spec.pk && c !== 'created_at')
    .map((c) => `${c} = excluded.${c}`)
    .concat('version = excluded.version');

  const sql =
    `INSERT INTO ${table} (${[...cols, 'version'].join(', ')}) ` +
    `VALUES (${placeholders.join(', ')}, (SELECT value FROM sync_meta WHERE key = 'version')) ` +
    `ON CONFLICT(${spec.pk}) DO UPDATE SET ${updates.join(', ')} ` +
    `WHERE excluded.updated_at > ${table}.updated_at`;

  return db.prepare(sql).bind(...cols.map((c) => row[c] ?? null));
}
