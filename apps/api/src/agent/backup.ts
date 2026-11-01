import {
  BACKUP_APPEND_TABLES,
  BACKUP_SNAPSHOT_TABLES,
  type BackupPullRequest,
  type BackupPullResponse,
} from '@maunedas/shared/api/agent';
import type { PullCursor } from '@maunedas/shared/api/sync';
import { TABLES, tablesInOrder } from '@maunedas/shared/sync/registry';
import { ApiError } from '../errors';

/** A snapshot table larger than this is a bug, not a household. */
const SNAPSHOT_MAX_ROWS = 1000;

type Kind = 'versioned' | 'append' | 'snapshot';

/** Every table of the backup in restore order (parents first), with its kind and primary key. */
function backupTables(): Array<{ table: string; kind: Kind; pk: string }> {
  return [
    ...tablesInOrder().map((t) => ({ table: t as string, kind: 'versioned' as const, pk: TABLES[t].pk })),
    ...Object.entries(BACKUP_APPEND_TABLES).map(([table, pk]) => ({ table, kind: 'append' as const, pk })),
    ...Object.entries(BACKUP_SNAPSHOT_TABLES).map(([table, pk]) => ({ table, kind: 'snapshot' as const, pk })),
  ];
}

/**
 * Backup pull (07 §5.4): the mirror's increments. Unlike `/v1/sync/pull` there is no user filter and rows keep
 * every column (`users.google_email` included). Caches, device tokens and the job queue are left out; a restore
 * recomputes `sync_meta` from the rows.
 */
export async function backupPull(db: D1Database, req: BackupPullRequest, now: number): Promise<BackupPullResponse> {
  const all = backupTables();
  const known = new Map(all.map((t) => [t.table, t]));
  const unknown = [
    ...(req.tables ?? []).filter((t) => !known.has(t)),
    // Snapshot tables come whole: a cursor for them is a mistake.
    ...Object.keys(req.cursors).filter((t) => known.get(t)?.kind !== 'versioned' && known.get(t)?.kind !== 'append'),
  ];
  if (unknown.length > 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', {
      issues: unknown.map((t) => ({ path: ['tables'], code: 'unknown_table', message: `Tabla desconocida: ${t}` })),
    });
  }
  const requested = new Set(req.tables ?? all.map((t) => t.table));
  const tables = all.filter((t) => requested.has(t.table));

  // Names come from the registry and the two constants above (no injection).
  const statements = tables.map(({ table, kind, pk }) => {
    if (kind === 'snapshot') return db.prepare(`SELECT * FROM ${table} ORDER BY ${pk} LIMIT ${SNAPSHOT_MAX_ROWS}`);
    const [position, last] = req.cursors[table] ?? [0, ''];
    const order = kind === 'versioned' ? 'version' : 'created_at';
    return db
      .prepare(`SELECT * FROM ${table} WHERE (${order}, ${pk}) > (?1, ?2) ORDER BY ${order}, ${pk} LIMIT ?3`)
      .bind(position, last, req.limit);
  });
  const schema = db.prepare(`SELECT value FROM sync_meta WHERE key = 'schema_version'`);
  const results = await db.batch<Record<string, unknown>>([...statements, schema]);

  const changes: BackupPullResponse['changes'] = {};
  const cursors: Record<string, PullCursor> = {};
  const replace: string[] = [];
  let hasMore = false;
  tables.forEach(({ table, kind, pk }, i) => {
    const rows = results[i]!.results;
    if (kind === 'snapshot') {
      // Sent even when empty: an empty table must empty the mirror's too.
      changes[table] = rows;
      replace.push(table);
      return;
    }
    const last = rows.at(-1);
    const order = kind === 'versioned' ? 'version' : 'created_at';
    cursors[table] = last ? [Number(last[order]), String(last[pk])] : (req.cursors[table] ?? [0, '']);
    if (rows.length > 0) changes[table] = rows;
    if (rows.length === req.limit) hasMore = true;
  });
  const schemaVersion = Number(results.at(-1)!.results[0]?.value ?? 0);
  return { changes, cursors, replace, has_more: hasMore, server_time: now, schema_version: schemaVersion };
}
