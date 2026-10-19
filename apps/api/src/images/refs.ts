import type { ImageRef } from '@maunedas/shared/api/catalog';
import type { Env } from '../env';
import { signPath } from './signing';

const IMAGE_REF_TTL_MS = 24 * 3_600_000;

/** Blob path served by `GET /v1/images/:id/blobs/:name` (T-037) for an R2 key `images/{id}/{name}`. */
function blobPath(r2Key: string): string {
  const [, imageId, name] = r2Key.split('/');
  return `/v1/images/${imageId}/blobs/${name}`;
}

/**
 * ImageRef (03 §3) for each live image id: signed absolute URLs to the selected thumb and processed
 * renditions and to the original. Two queries for any number of images.
 */
export async function imageRefs(
  env: Pick<Env, 'DB' | 'IMAGE_URL_SECRET' | 'PUBLIC_BASE_URL'>,
  ids: Array<string | null | undefined>,
  now = Date.now(),
): Promise<Map<string, ImageRef>> {
  const wanted = [...new Set(ids.filter((id): id is string => typeof id === 'string'))];
  const refs = new Map<string, ImageRef>();
  if (wanted.length === 0) return refs;

  const json = JSON.stringify(wanted);
  const [images, renditions] = await env.DB.batch<Record<string, unknown>>([
    env.DB.prepare(
      `SELECT id, original_key, selected_processed_id, selected_thumb_id, license, attribution
       FROM images WHERE deleted_at IS NULL AND id IN (SELECT value FROM json_each(?1))`,
    ).bind(json),
    env.DB.prepare(
      `SELECT id, r2_key FROM image_renditions
       WHERE deleted_at IS NULL AND image_id IN (SELECT value FROM json_each(?1))`,
    ).bind(json),
  ]);
  const keyOf = new Map(renditions!.results.map((r) => [String(r.id), String(r.r2_key)]));
  const url = async (r2Key: string | null | undefined) =>
    r2Key
      ? `${env.PUBLIC_BASE_URL}${await signPath(env.IMAGE_URL_SECRET, blobPath(r2Key), IMAGE_REF_TTL_MS, now)}`
      : null;

  for (const img of images!.results) {
    refs.set(String(img.id), {
      image_id: String(img.id),
      thumb_url: await url(keyOf.get(String(img.selected_thumb_id))),
      processed_url: await url(keyOf.get(String(img.selected_processed_id))),
      original_url: await url(img.original_key as string | null),
      license: (img.license as string | null) ?? null,
      attribution: (img.attribution as string | null) ?? null,
    });
  }
  return refs;
}
