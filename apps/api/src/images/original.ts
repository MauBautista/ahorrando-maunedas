import type { AppEnv } from '../env';
import { ApiError } from '../errors';

export interface CatalogPhoto {
  original_key: string;
  edit_params: string | null;
  updated_at: number;
  /** `edit_params.manual` as SQLite reads it. */
  manual: unknown;
}

/**
 * A live product photo whose original is already in R2: what "Mejorar en casa", the editor and the AI edit start
 * from (10 §6). Another photo is `404`; one still uploading, `409 E-IMAGE_NOT_UPLOADED`.
 */
export async function catalogPhoto(env: AppEnv['Bindings'], imageId: string): Promise<CatalogPhoto> {
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
  return { ...image, original_key: image.original_key };
}
