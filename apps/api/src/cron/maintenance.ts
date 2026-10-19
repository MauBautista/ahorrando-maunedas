import { FOUND_TTL_MS, NOT_FOUND_TTL_MS } from '../catalog/off';

/** Daily maintenance runs on the 04:07 tick, Mexico City time (03 §2). */
export const MAINTENANCE_HOUR = 4;
/** Finished image jobs are kept this long for debugging; queued and claimed ones are never removed. */
export const IMAGE_JOB_RETENTION_MS = 30 * 86_400_000;

const mexicoHour = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Mexico_City',
  hour: 'numeric',
  hourCycle: 'h23',
});

/** Whether a tick falls in the maintenance hour in Mexico City (DST-proof: the time zone decides). */
export function isMaintenanceTick(scheduledTime: number): boolean {
  return Number(mexicoHour.format(scheduledTime)) === MAINTENANCE_HOUR;
}

/**
 * Deletes expired `token_cache` rows, `off_cache` rows past their freshness (hit 30 days, miss 7 — the
 * same windows the lookup uses) and image jobs finished more than 30 days ago. Server tables only:
 * nothing synced is touched. Returns the rows deleted per table.
 */
export async function runMaintenance(db: D1Database, now: number): Promise<Record<string, number>> {
  const [tokens, catalog, jobs] = await db.batch([
    db.prepare('DELETE FROM token_cache WHERE expires_at < ?1').bind(now),
    db
      .prepare(
        'DELETE FROM off_cache WHERE (found = 1 AND fetched_at < ?1) OR (found = 0 AND fetched_at < ?2)',
      )
      .bind(now - FOUND_TTL_MS, now - NOT_FOUND_TTL_MS),
    db
      .prepare(`DELETE FROM image_jobs WHERE status IN ('done', 'failed') AND updated_at < ?1`)
      .bind(now - IMAGE_JOB_RETENTION_MS),
  ]);
  return {
    token_cache: tokens!.meta.changes,
    off_cache: catalog!.meta.changes,
    image_jobs: jobs!.meta.changes,
  };
}
