import type { AgentListing, AgentWorkRequest, AgentWorkResponse } from '@maunedas/shared/api/agent';

/** Listings per `/work` answer; the agent asks again while `has_more`. */
export const LISTINGS_PAGE = 200;
/** "En línea" is a heartbeat within this (03 §12 `GET /v1/admin/agent`). */
export const ONLINE_MS = 3 * 60_000;
/** A heartbeat reaches clients (a new `version`) at most this often, unless something they show changed. */
export const STATUS_EVERY_MS = 10 * 60_000;
/** `token_cache` key the watchdog writes when it warned of an outage (T-214); a heartbeat after it clears it. */
export const AGENT_OFFLINE_MARK = 'agent_offline_notified';
/** Minimum seconds between requests to one domain (07 §5.1, §7; CLAUDE.md rule 10). */
export const MIN_SPACING_S = { amazon_mx: 45, sams_mx: 30, costco_mx: 30, default: 20 };

const VERSION = `(SELECT value FROM sync_meta WHERE key = 'version')`;

interface ListingRow extends Omit<AgentListing, 'active'> {
  active: number;
  deleted_at: number | null;
}

/** `info.blocked` as a set, so only a real change counts. */
function blockedOf(info: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(info ?? '{}') as { blocked?: unknown };
    return Array.isArray(parsed.blocked) ? [...new Set(parsed.blocked.map(String))].sort() : [];
  } catch {
    return [];
  }
}

/**
 * The agent's heartbeat (07 §5.1): `agent_status` always takes the heartbeat, version and info; it gets a new
 * `version` (so clients pull it) only when the blocked adapters changed, when the agent was offline, or every
 * [STATUS_EVERY_MS]. Coming back after an outage also clears the watchdog's mark, so the next one is warned again.
 */
export async function recordHeartbeat(db: D1Database, req: AgentWorkRequest, now: number): Promise<void> {
  const prev = await db
    .prepare('SELECT last_heartbeat_at, info, updated_at FROM agent_status WHERE id = ?1')
    .bind(req.agent_id)
    .first<{ last_heartbeat_at: number | null; info: string | null; updated_at: number }>();
  const blocked = [...new Set(req.info.blocked)].sort();
  const info = JSON.stringify({ ...req.info, blocked });
  const offline = !prev || prev.last_heartbeat_at === null || now - prev.last_heartbeat_at >= ONLINE_MS;
  const changed = !prev || JSON.stringify(blockedOf(prev.info)) !== JSON.stringify(blocked);
  const due = !prev || now - prev.updated_at >= STATUS_EVERY_MS;
  const clearMark =
    prev && offline ? [db.prepare('DELETE FROM token_cache WHERE key = ?1').bind(AGENT_OFFLINE_MARK)] : [];
  if (offline || changed || due) {
    await db.batch([
      db.prepare(`UPDATE sync_meta SET value = value + 1 WHERE key = 'version'`),
      db
        .prepare(
          `INSERT INTO agent_status (id, last_heartbeat_at, agent_version, info, updated_at, version)
           VALUES (?1, ?2, ?3, ?4, ?2, ${VERSION})
           ON CONFLICT(id) DO UPDATE SET last_heartbeat_at = excluded.last_heartbeat_at,
             agent_version = excluded.agent_version, info = excluded.info,
             updated_at = excluded.updated_at, version = excluded.version`,
        )
        .bind(req.agent_id, now, req.agent_version, info),
      ...clearMark,
    ]);
    return;
  }
  // `updated_at` stays the time of the last version, which is what the 10 minutes count from.
  await db
    .prepare('UPDATE agent_status SET last_heartbeat_at = ?2, agent_version = ?3, info = ?4 WHERE id = ?1')
    .bind(req.agent_id, now, req.agent_version, info)
    .run();
}

/** `POST /agent/v1/work` (07 §5.1): the heartbeat, then what the agent has to check. */
export async function agentWork(
  db: D1Database,
  req: AgentWorkRequest,
  now: number,
  pageSize = LISTINGS_PAGE,
): Promise<AgentWorkResponse> {
  await recordHeartbeat(db, req, now);
  const [cursorVersion, cursorId] = req.cursor;
  const [listings, stores, checkNow, jobs] = await db.batch<Record<string, unknown>>([
    db
      .prepare(
        `SELECT id, adapter, url, canonical_url, external_id, store_id, check_interval_min AS interval_min,
                active, deleted_at, version
         FROM listings WHERE (version, id) > (?1, ?2) ORDER BY version, id LIMIT ?3`,
      )
      .bind(cursorVersion, cursorId, pageSize + 1),
    db.prepare('SELECT id, default_check_interval_min FROM stores WHERE deleted_at IS NULL'),
    db.prepare(
      `SELECT s.listing_id FROM listing_state s JOIN listings l ON l.id = s.listing_id
       WHERE l.deleted_at IS NULL AND l.active = 1 AND s.check_requested_at > COALESCE(s.last_checked_at, 0)
       ORDER BY s.check_requested_at`,
    ),
    db.prepare(`SELECT count(*) AS n FROM image_jobs WHERE status = 'queued'`),
  ]);
  const rows = listings!.results as unknown as ListingRow[];
  const page = rows.slice(0, pageSize);
  const last = page.at(-1);
  return {
    server_time: now,
    listings: {
      upserts: page
        .filter((l) => l.deleted_at === null && l.active === 1)
        .map(({ deleted_at: _deleted, ...l }) => l),
      removed: page.filter((l) => l.deleted_at !== null || l.active !== 1).map((l) => l.id),
      cursor: last ? [last.version, last.id] : [cursorVersion, cursorId],
      has_more: rows.length > pageSize,
    },
    store_defaults: Object.fromEntries(
      (stores!.results as Array<{ id: string; default_check_interval_min: number }>).map((s) => [
        s.id,
        s.default_check_interval_min,
      ]),
    ),
    check_now: (checkNow!.results as Array<{ listing_id: string }>).map((r) => r.listing_id),
    image_jobs_queued: Number((jobs!.results[0] as { n: number } | undefined)?.n ?? 0),
    config: { min_spacing_s: MIN_SPACING_S },
  };
}
