import { type AgentJobClaim, JOB_LEASE_MS, JOB_MAX_ATTEMPTS } from '@maunedas/shared/api/agent';
import { uuidv7 } from '@maunedas/shared/util/uuid';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';
import { blobKey } from '../images/blobs';

type Bindings = AppEnv['Bindings'];

/** What the agent uploads for a job, and how it is kept (07 §5.3, 10 §1). */
export const RESULT_KINDS = {
  mask: { ext: 'png', contentType: 'image/png' },
  processed: { ext: 'webp', contentType: 'image/webp' },
  thumb: { ext: 'webp', contentType: 'image/webp' },
} as const;
export type ResultKind = keyof typeof RESULT_KINDS;

interface JobRow {
  id: string;
  image_id: string;
  op: 'remove_bg';
  status: string;
  attempts: number;
}

/**
 * The oldest job to do, claimed atomically (07 §5.3): a queued one, or one whose lease ran out. A lease that ran out
 * on the last attempt ends the job as `failed` first, so a photo that always breaks the agent stops coming back.
 */
export async function claimJob(db: D1Database, now: number): Promise<AgentJobClaim['job'] | null> {
  const expired = now - JOB_LEASE_MS;
  const [, claimed] = await db.batch<JobRow>([
    db
      .prepare(
        `UPDATE image_jobs SET status = 'failed', error = COALESCE(error, 'el agente no terminó a tiempo'), updated_at = ?1
         WHERE status = 'claimed' AND claimed_at < ?2 AND attempts >= ?3`,
      )
      .bind(now, expired, JOB_MAX_ATTEMPTS),
    db
      .prepare(
        `UPDATE image_jobs SET status = 'claimed', claimed_at = ?1, attempts = attempts + 1, updated_at = ?1
         WHERE id = (
           SELECT id FROM image_jobs
           WHERE status = 'queued' OR (status = 'claimed' AND claimed_at < ?2)
           ORDER BY created_at, id LIMIT 1
         )
         RETURNING id, image_id, op, status, attempts`,
      )
      .bind(now, expired),
  ]);
  const job = claimed!.results[0];
  if (!job) return null;
  return {
    id: job.id,
    image_id: job.image_id,
    op: job.op,
    original_url: `/agent/v1/images/${job.image_id}/original`,
    attempts: job.attempts,
  };
}

/** A job the agent holds: claimed and within its lease. Anything else is `404`, so a late agent stops. */
async function heldJob(db: D1Database, jobId: string, now: number): Promise<JobRow> {
  const job = await db
    .prepare(
      `SELECT id, image_id, op, status, attempts FROM image_jobs
       WHERE id = ?1 AND status = 'claimed' AND claimed_at >= ?2`,
    )
    .bind(jobId, now - JOB_LEASE_MS)
    .first<JobRow>();
  if (!job) throw new ApiError(404, 'NOT_FOUND');
  return job;
}

/** The photo's original, as R2 keeps it (`GET /agent/v1/images/:imageId/original`). */
export async function originalOf(env: Bindings, imageId: string): Promise<R2ObjectBody> {
  const image = await env.DB.prepare('SELECT original_key FROM images WHERE id = ?1 AND deleted_at IS NULL')
    .bind(imageId)
    .first<{ original_key: string | null }>();
  const object = image?.original_key ? await env.IMAGES.get(image.original_key) : null;
  if (!object) throw new ApiError(404, 'NOT_FOUND');
  return object;
}

/**
 * One result of a held job: kept in R2 under its own immutable key and recorded as an `image_renditions` row with
 * `tier='home'` and a new sync version, so every client gets it by pull and adopts it (10 §6.1).
 */
export async function saveResult(
  env: Bindings,
  jobId: string,
  kind: ResultKind,
  body: ReadableStream,
  length: number,
  size: { width: number | null; height: number | null },
  now: number,
): Promise<string> {
  const job = await heldJob(env.DB, jobId, now);
  const id = uuidv7(now);
  const key = blobKey(job.image_id, `${id}.${RESULT_KINDS[kind].ext}`);
  await env.IMAGES.put(key, body.pipeThrough(new FixedLengthStream(length)), {
    httpMetadata: { contentType: RESULT_KINDS[kind].contentType },
  });
  await env.DB.batch([
    env.DB.prepare(`UPDATE sync_meta SET value = value + 1 WHERE key = 'version'`),
    env.DB.prepare(
      `INSERT INTO image_renditions (id, image_id, kind, tier, r2_key, width, height, bytes, created_at, updated_at, version)
       VALUES (?1, ?2, ?3, 'home', ?4, ?5, ?6, ?7, ?8, ?8, (SELECT value FROM sync_meta WHERE key = 'version'))`,
    ).bind(id, job.image_id, kind, key, size.width, size.height, length, now),
  ]);
  return id;
}

export async function completeJob(db: D1Database, jobId: string, now: number): Promise<void> {
  await heldJob(db, jobId, now);
  await db
    .prepare(`UPDATE image_jobs SET status = 'done', error = NULL, updated_at = ?1 WHERE id = ?2`)
    .bind(now, jobId)
    .run();
}

/** A failed try goes back to the queue, unless it was the last one. */
export async function failJob(db: D1Database, jobId: string, error: string, now: number): Promise<void> {
  const job = await heldJob(db, jobId, now);
  const status = job.attempts >= JOB_MAX_ATTEMPTS ? 'failed' : 'queued';
  await db
    .prepare(`UPDATE image_jobs SET status = ?1, error = ?2, claimed_at = NULL, updated_at = ?3 WHERE id = ?4`)
    .bind(status, error, now, jobId)
    .run();
}
