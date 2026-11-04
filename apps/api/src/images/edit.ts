import type { EditSourceResponse } from '@maunedas/shared/api/images';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';
import { signedBlobUrl } from './refs';

/** Renditions made without anyone's hand (ARQUITECTURA §9.1): the phone's cut-out and the home server's. */
const AUTOMATIC = new Set(['device', 'home']);

interface RenditionRow {
  id: string;
  kind: string;
  tier: string;
  r2_key: string;
  width: number | null;
  height: number | null;
}

/**
 * What the photo editor starts from (10 §6.2, T-301): a live catalog photo whose original is in R2 (else `409
 * IMAGE_NOT_UPLOADED`, as "Mejorar en casa"), its `edit_params`, the mask to lay on it and the automatic result
 * "Restablecer" goes back to. Renditions are read newest last, by `(created_at, id)` as `ImageRef.adopt`.
 */
export async function editSource(
  env: AppEnv['Bindings'],
  imageId: string,
  now: number,
): Promise<EditSourceResponse> {
  const image = await env.DB.prepare(
    `SELECT original_key, edit_params, updated_at, json_extract(edit_params, '$.manual') AS manual
     FROM images WHERE id = ?1 AND role = 'catalog' AND deleted_at IS NULL`,
  )
    .bind(imageId)
    .first<{
      original_key: string | null;
      edit_params: string | null;
      updated_at: number;
      manual: unknown;
    }>();
  if (!image) throw new ApiError(404, 'NOT_FOUND');
  if (!image.original_key || !(await env.IMAGES.head(image.original_key))) {
    throw new ApiError(409, 'IMAGE_NOT_UPLOADED');
  }
  const { results } = await env.DB.prepare(
    `SELECT id, kind, tier, r2_key, width, height FROM image_renditions
     WHERE image_id = ?1 AND deleted_at IS NULL ORDER BY created_at, id`,
  )
    .bind(imageId)
    .all<RenditionRow>();

  const newest = (kind: string, tiers: (tier: string) => boolean) =>
    results.findLast((r) => r.kind === kind && tiers(r.tier));
  const automatic = (tier: string) => AUTOMATIC.has(tier);
  const manual = image.manual === 1 || image.manual === true;
  const mask = (manual ? newest('mask', (t) => t === 'manual') : undefined) ?? newest('mask', automatic);
  const processed = newest('processed', automatic);
  const thumb = newest('thumb', automatic);
  return {
    image_id: imageId,
    updated_at: image.updated_at,
    original_url: await signedBlobUrl(env, image.original_key, now),
    edit_params: image.edit_params,
    mask: mask
      ? { url: await signedBlobUrl(env, mask.r2_key, now), width: mask.width, height: mask.height }
      : null,
    automatic: processed && thumb ? { processed_id: processed.id, thumb_id: thumb.id } : null,
  };
}
