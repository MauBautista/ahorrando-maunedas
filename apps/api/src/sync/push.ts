import type { ConflictReason, PushConflict, PushResponse } from '@maunedas/shared/api/sync';
import {
  isTableName,
  TABLES,
  USER_COLUMN,
  type Row,
  type TableName,
  type TableSpec,
} from '@maunedas/shared/sync/registry';
import { ROW_SCHEMAS } from '@maunedas/shared/sync/rows';
import type { UserRow } from '../db/rows';
import { ApiError } from '../errors';
import { buildUpsert } from './upsert';

const CLOCK_SKEW_MS = 5 * 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Columns an append-only row may change after creation. */
const APPEND_ONLY_MUTABLE = new Set(['deleted_at', 'updated_at', 'updated_by', 'created_at']);
const CLIENT_RENDITION_TIERS = new Set(['device', 'manual']);

interface Candidate {
  index: number;
  table: TableName;
  spec: TableSpec;
  id: string;
  /** Sanitized writable columns sent by the client (plus derived ones): what gets written. */
  incoming: Row;
  /** Existing row (all columns) or null. */
  existing: Row | null;
  /** Existing writable columns overlaid with `incoming`: what the row will look like. */
  merged: Row;
}

/**
 * Push algorithm (04 §3.2). Conflicts never fail the request; only a D1 constraint error does
 * (`409 BATCH_REJECTED`, nothing written).
 */
export async function pushMutations(
  db: D1Database,
  user: UserRow,
  mutations: ReadonlyArray<{ table: string; row: Row }>,
  now: number,
): Promise<PushResponse> {
  const conflicts: PushConflict[] = [];
  const conflict = (
    c: Candidate | { table: string; id: string },
    reason: ConflictReason,
    details?: unknown,
    serverRow?: Row | null,
  ) =>
    conflicts.push({
      table: c.table,
      id: c.id,
      reason,
      server_row: serverRow !== undefined ? serverRow : 'existing' in c ? c.existing : null,
      ...(details === undefined ? {} : { details }),
    });

  // 1–3. Classify and sanitize.
  const sanitized: Array<Omit<Candidate, 'existing' | 'merged'>> = [];
  mutations.forEach((m, index) => {
    const rawId = m.row.id ?? m.row.listing_id;
    const idText = typeof rawId === 'string' ? rawId : '';
    if (!isTableName(m.table) || TABLES[m.table].mode !== 'sync') {
      conflict({ table: m.table, id: idText }, 'UNKNOWN_TABLE', undefined, null);
      return;
    }
    const table = m.table;
    const spec: TableSpec = TABLES[table];
    const incoming: Row = {};
    for (const column of spec.writable ?? [])
      if (Object.hasOwn(m.row, column)) incoming[column] = m.row[column];

    const id = incoming[spec.pk];
    if (typeof id !== 'string' || !UUID.test(id)) {
      conflict({ table, id: idText }, 'VALIDATION', issue([spec.pk], 'id inválido'), null);
      return;
    }
    if (typeof incoming.updated_at !== 'number' || !Number.isFinite(incoming.updated_at)) {
      conflict({ table, id }, 'VALIDATION', issue(['updated_at'], 'updated_at es obligatorio'), null);
      return;
    }
    incoming.updated_at = Math.min(incoming.updated_at, now + CLOCK_SKEW_MS);
    incoming.updated_by = user.id;
    if (spec.scope === 'user') incoming[USER_COLUMN] = user.id;
    sanitized.push({ index, table, spec, id, incoming });
  });

  // The same row twice in one push: the last occurrence wins, earlier ones are rejected.
  const lastByKey = new Map<string, number>();
  for (const s of sanitized) lastByKey.set(`${s.table}:${s.id}`, s.index);
  const unique = sanitized.filter((s) => {
    if (lastByKey.get(`${s.table}:${s.id}`) === s.index) return true;
    conflict({ table: s.table, id: s.id }, 'VALIDATION', { reason: 'DUPLICATE_IN_BATCH' }, null);
    return false;
  });

  // 5. Existing rows: one SELECT per table, all in one round trip.
  const existingByKey = await readExisting(db, unique);

  // 4 + 6. Merge, derive, validate and apply the rules that need the existing row.
  let identicalRetries = 0;
  const accepted: Candidate[] = [];
  const measureChanges: Candidate[] = [];
  for (const s of unique) {
    const existing = existingByKey.get(`${s.table}:${s.id}`) ?? null;
    const base = existing ? pick(existing, s.spec.writable ?? []) : {};
    let merged: Row = { ...base, ...s.incoming };
    if (s.spec.derive) {
      // Derived columns use the full row: a partial row must not lose the brand from search_key.
      const derived = s.spec.derive(merged);
      for (const [k, v] of Object.entries(derived)) if (merged[k] !== v) s.incoming[k] = v;
      merged = derived;
    }
    const c: Candidate = { ...s, existing, merged };

    const parsed = ROW_SCHEMAS[s.table].safeParse(merged);
    if (!parsed.success) {
      conflict(c, 'VALIDATION', {
        issues: parsed.error.issues.map((i) => ({
          path: i.path.map(String),
          code: i.code,
          message: i.message,
        })),
      });
      continue;
    }
    const data = parsed.data as Row;
    for (const k of Object.keys(s.incoming)) if (k in data) s.incoming[k] = data[k]; // e.g. trimmed names
    c.merged = { ...merged, ...data };

    if (existing) {
      if (existing.updated_at === s.incoming.updated_at && existing.updated_by === user.id) {
        identicalRetries++; // the previous response was lost after the commit
        continue;
      }
      if ((existing.updated_at as number) >= (s.incoming.updated_at as number)) {
        conflict(c, 'STALE');
        continue;
      }
      if (s.spec.appendOnly && changesImmutable(s.incoming, existing)) {
        conflict(c, 'IMMUTABLE_ROW');
        continue;
      }
    }
    const forbidden = forbiddenReason(c, user);
    if (forbidden) {
      conflict(c, 'FORBIDDEN', { reason: forbidden });
      continue;
    }
    if (s.table === 'variants' && existing && existing.measure !== c.merged.measure) measureChanges.push(c);
    accepted.push(c);
  }

  // A variant's measure cannot change once it has purchases (04 §2).
  const locked = await variantsWithPurchases(
    db,
    measureChanges.map((c) => c.id),
  );
  const afterMeasure = accepted.filter((c) => {
    if (!locked.has(c.id) || !measureChanges.includes(c)) return true;
    conflict(c, 'VALIDATION', { reason: 'MEASURE_LOCKED' });
    return false;
  });

  // 7. Partial unique indexes among live rows.
  const writable = await checkUniques(db, afterMeasure, (c, reason, details, serverRow) =>
    conflict(c, reason, details, serverRow),
  );

  // Parents must exist (in D1, even tombstoned, or accepted in this push): a missing parent rejects only
  // that row instead of the whole batch.
  const withParents = await checkParents(db, writable, (c, details) => conflict(c, 'VALIDATION', details));

  // 8–9. One batch: deferred foreign keys, one new version, upserts parents first.
  const toWrite = withParents;
  if (toWrite.length > 0) {
    toWrite.sort((a, b) => a.spec.order - b.spec.order || a.index - b.index);
    const statements = [
      db.prepare('PRAGMA defer_foreign_keys = on'),
      db.prepare(`UPDATE sync_meta SET value = value + 1 WHERE key = 'version'`),
      ...toWrite.map((c) => buildUpsert(db, c.table, c.spec, c.incoming, c.merged)),
    ];
    try {
      await db.batch(statements);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/constraint failed/i.test(message)) throw new ApiError(409, 'BATCH_REJECTED', { message });
      throw err;
    }
  }

  return { applied: toWrite.length + identicalRetries, skipped: conflicts.length, conflicts };
}

const issue = (path: string[], message: string) => ({ issues: [{ path, code: 'custom', message }] });

function pick(row: Row, columns: readonly string[]): Row {
  const out: Row = {};
  for (const c of columns) if (c in row) out[c] = row[c];
  return out;
}

async function readExisting(
  db: D1Database,
  candidates: ReadonlyArray<{ table: TableName; spec: TableSpec; id: string }>,
) {
  const idsByTable = new Map<TableName, string[]>();
  for (const c of candidates) idsByTable.set(c.table, [...(idsByTable.get(c.table) ?? []), c.id]);
  const tables = [...idsByTable.keys()];
  const byKey = new Map<string, Row>();
  if (tables.length === 0) return byKey;
  const results = await db.batch<Row>(
    tables.map((t) =>
      db
        .prepare(`SELECT * FROM ${t} WHERE ${TABLES[t].pk} IN (SELECT value FROM json_each(?1))`)
        .bind(JSON.stringify(idsByTable.get(t))),
    ),
  );
  results.forEach((r, i) => {
    const t = tables[i]!;
    for (const row of r.results) byKey.set(`${t}:${String(row[TABLES[t].pk])}`, row);
  });
  return byKey;
}

function changesImmutable(incoming: Row, existing: Row): boolean {
  return Object.keys(incoming).some((k) => !APPEND_ONLY_MUTABLE.has(k) && incoming[k] !== existing[k]);
}

/** FORBIDDEN rules of 04 §3.2 step 6; returns the reason or null. */
function forbiddenReason(c: Candidate, user: UserRow): string | null {
  const { existing, merged } = c;
  const isNewTombstone = merged.deleted_at != null && (existing === null || existing.deleted_at == null);
  if (c.spec.adminDelete && isNewTombstone && user.role !== 'admin') return 'ADMIN_DELETE';
  if (c.spec.scope === 'user' && existing && existing[USER_COLUMN] !== user.id) return 'NOT_OWNER';
  if (c.table === 'price_observations') {
    if (merged.source !== 'shelf') return 'WEB_OBSERVATION';
    if (existing && existing.source === 'web') return 'WEB_OBSERVATION';
  }
  if (
    c.table === 'image_renditions' &&
    existing === null &&
    !CLIENT_RENDITION_TIERS.has(String(merged.tier))
  ) {
    return 'RENDITION_TIER';
  }
  return null;
}

async function variantsWithPurchases(db: D1Database, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { results } = await db
    .prepare(
      `SELECT DISTINCT variant_id FROM purchase_items
       WHERE deleted_at IS NULL AND variant_id IN (SELECT value FROM json_each(?1))`,
    )
    .bind(JSON.stringify(ids))
    .all<{ variant_id: string }>();
  return new Set(results.map((r) => r.variant_id));
}

type ConflictFn = (c: Candidate, reason: ConflictReason, details: unknown, serverRow?: Row | null) => void;

/**
 * Foreign keys checked before the batch (`refs` in the registry). A parent may already be in D1 (live or
 * tombstoned) or be accepted in this same push; rejecting a parent also rejects its children here.
 */
async function checkParents(
  db: D1Database,
  candidates: Candidate[],
  reject: (c: Candidate, details: unknown) => void,
): Promise<Candidate[]> {
  const needed = new Map<string, Set<string>>();
  for (const c of candidates) {
    for (const [column, parent] of Object.entries(c.spec.refs ?? {})) {
      const value = c.merged[column];
      if (value == null) continue;
      if (!needed.has(parent)) needed.set(parent, new Set());
      needed.get(parent)!.add(String(value));
    }
  }
  const parents = [...needed.keys()];
  const inDb = new Set<string>();
  if (parents.length > 0) {
    const results = await db.batch<{ id: string }>(
      parents.map((t) =>
        db
          .prepare(
            `SELECT ${TABLES[t as TableName].pk} AS id FROM ${t} WHERE ${TABLES[t as TableName].pk} IN (SELECT value FROM json_each(?1))`,
          )
          .bind(JSON.stringify([...needed.get(t)!])),
      ),
    );
    results.forEach((r, i) => r.results.forEach((row) => inDb.add(`${parents[i]}:${row.id}`)));
  }

  const accepted = new Set(candidates);
  const acceptedIds = new Set(candidates.map((c) => `${c.table}:${c.id}`));
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of accepted) {
      for (const [column, parent] of Object.entries(c.spec.refs ?? {})) {
        const value = c.merged[column];
        if (value == null) continue;
        const key = `${parent}:${String(value)}`;
        if (inDb.has(key) || acceptedIds.has(key)) continue;
        reject(c, { reason: 'MISSING_PARENT', column, table: parent });
        accepted.delete(c);
        acceptedIds.delete(`${c.table}:${c.id}`);
        changed = true;
        break;
      }
    }
  }
  return candidates.filter((c) => accepted.has(c));
}

/**
 * Live rows with the same unique values and another id → BARCODE_TAKEN / ALIAS_TAKEN, unless that other
 * row is being tombstoned or changed in this same push. Inside the batch the first claim wins.
 */
async function checkUniques(
  db: D1Database,
  candidates: Candidate[],
  conflict: ConflictFn,
): Promise<Candidate[]> {
  const inBatch = new Map(candidates.map((c) => [`${c.table}:${c.id}`, c]));
  const rejected = new Set<Candidate>();

  for (const table of new Set(candidates.map((c) => c.table))) {
    const spec: TableSpec = TABLES[table];
    if (!spec.uniqueLive) continue;
    const { columns, conflict: reason } = spec.uniqueLive;
    const keyOf = (row: Row) => JSON.stringify(columns.map((col) => row[col]));
    const live = candidates.filter((c) => c.table === table && c.merged.deleted_at == null);
    if (live.length === 0) continue;

    const on = columns.map((col, i) => `t.${col} = json_extract(j.value, '$[${i}]')`).join(' AND ');
    const { results } = await db
      .prepare(`SELECT t.* FROM ${table} t JOIN json_each(?1) j ON ${on} WHERE t.deleted_at IS NULL`)
      .bind(JSON.stringify(live.map((c) => columns.map((col) => c.merged[col]))))
      .all<Row>();

    const claimed = new Map<string, Candidate>();
    for (const c of live.sort((a, b) => a.index - b.index)) {
      const key = keyOf(c.merged);
      const holder = results.find((r) => keyOf(r) === key && r[spec.pk] !== c.id);
      const holderStillThere =
        holder &&
        (() => {
          const moving = inBatch.get(`${table}:${String(holder[spec.pk])}`);
          return (
            !moving ||
            rejected.has(moving) ||
            (moving.merged.deleted_at == null && keyOf(moving.merged) === key)
          );
        })();
      const earlier = claimed.get(key);
      if (holderStillThere || earlier) {
        const owner = holderStillThere ? holder : earlier!.merged;
        rejected.add(c);
        if (reason === 'BARCODE_TAKEN') {
          conflict(c, reason, { variant_id: owner.variant_id, barcode_id: owner.id });
        } else {
          conflict(c, reason, undefined, owner);
        }
        continue;
      }
      claimed.set(key, c);
    }
  }
  return candidates.filter((c) => !rejected.has(c));
}
