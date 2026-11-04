import { uuidv7 } from '@maunedas/shared/util/uuid';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';

/**
 * "Mejorar en casa" (10 §6.1, T-300): queues `remove_bg` for a live catalog photo whose original is already in R2.
 * A job still queued or claimed for it is answered again instead of queuing another; the client sets
 * `enhance_requested_at` itself, by sync.
 */
export async function requestEnhance(env: AppEnv['Bindings'], imageId: string, now: number): Promise<string> {
  const image = await env.DB.prepare(
    `SELECT original_key FROM images WHERE id = ?1 AND role = 'catalog' AND deleted_at IS NULL`,
  )
    .bind(imageId)
    .first<{ original_key: string | null }>();
  if (!image) throw new ApiError(404, 'NOT_FOUND');
  if (!image.original_key || !(await env.IMAGES.head(image.original_key))) {
    throw new ApiError(409, 'IMAGE_NOT_UPLOADED');
  }
  const waiting = await env.DB.prepare(
    `SELECT id FROM image_jobs WHERE image_id = ?1 AND status IN ('queued', 'claimed') ORDER BY created_at LIMIT 1`,
  )
    .bind(imageId)
    .first<{ id: string }>();
  if (waiting) return waiting.id;
  const id = uuidv7(now);
  await env.DB.prepare(
    `INSERT INTO image_jobs (id, image_id, op, status, attempts, created_at, updated_at)
     VALUES (?1, ?2, 'remove_bg', 'queued', 0, ?3, ?3)`,
  )
    .bind(id, imageId, now)
    .run();
  return id;
}
