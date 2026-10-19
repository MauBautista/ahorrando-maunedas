import type { PullCursor, PullRequest, PullResponse } from '@maunedas/shared/api/sync';
import {
  isTableName,
  TABLES,
  tablesInOrder,
  USER_COLUMN,
  type TableName,
} from '@maunedas/shared/sync/registry';
import type { UserRow } from '../db/rows';
import { ApiError } from '../errors';

/**
 * Pull (04 §4.2): one keyset read per table with the compound cursor `(version, pk)`, all in one D1 batch
 * together with `schema_version`. Rows sharing a version (one push) are never skipped across pages.
 */
export async function pullChanges(
  db: D1Database,
  user: UserRow,
  req: PullRequest,
  now: number,
): Promise<PullResponse> {
  const unknown = [...(req.tables ?? []), ...Object.keys(req.cursors)].filter((t) => !isTableName(t));
  if (unknown.length > 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', {
      issues: unknown.map((t) => ({
        path: ['tables'],
        code: 'unknown_table',
        message: `Tabla desconocida: ${t}`,
      })),
    });
  }
  const requested = new Set(req.tables ?? tablesInOrder());
  const tables = tablesInOrder().filter((t) => requested.has(t));

  const statements = tables.map((t) => {
    const spec = TABLES[t];
    const [version, last] = req.cursors[t] ?? [0, ''];
    const byUser = spec.scope === 'user' ? ` AND ${USER_COLUMN} = ?4` : '';
    // Names come from the registry whitelist (no injection).
    const sql =
      `SELECT ${spec.columns.join(', ')} FROM ${t} ` +
      `WHERE (version, ${spec.pk}) > (?1, ?2)${byUser} ORDER BY version, ${spec.pk} LIMIT ?3`;
    const params: unknown[] = [version, last, req.limit];
    if (spec.scope === 'user') params.push(user.id);
    return db.prepare(sql).bind(...params);
  });
  const schemaStatement = db.prepare(`SELECT value FROM sync_meta WHERE key = 'schema_version'`);
  const results = await db.batch<Record<string, unknown>>([...statements, schemaStatement]);

  const changes: PullResponse['changes'] = {};
  const cursors: Record<string, PullCursor> = {};
  let hasMore = false;
  tables.forEach((t: TableName, i) => {
    const rows = results[i]!.results;
    const pk = TABLES[t].pk;
    const last = rows.at(-1);
    cursors[t] = last ? [Number(last.version), String(last[pk])] : (req.cursors[t] ?? [0, '']);
    if (rows.length > 0) changes[t] = rows;
    if (rows.length === req.limit) hasMore = true;
  });
  const schemaVersion = Number(results.at(-1)!.results[0]?.value ?? 0);

  return { changes, cursors, has_more: hasMore, server_time: now, schema_version: schemaVersion };
}
