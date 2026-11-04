import { z } from 'zod';

/** Upload limits (10 §2.3, §4.1). */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

/** Hosts an open catalog photo may be imported from (10 §2.3). */
export const IMPORT_HOSTS = [
  'images.openfoodfacts.org',
  'static.openfoodfacts.org',
  'images.openbeautyfacts.org',
  'images.openproductsfacts.org',
] as const;

/** `POST /v1/images/:imageId/import`. */
export const ImportImageRequestSchema = z.object({ source_url: z.string().max(1000) });

export interface BlobResponse {
  key: string;
  bytes: number;
}

/** `POST /v1/images/:imageId/enhance` (10 §6.1): the queued `remove_bg` job, new or the one already waiting. */
export interface EnhanceResponse {
  job_id: string;
}

/** `GET /v1/images/:imageId/edit` (10 §6.2): what the photo editor starts from. URLs are signed (10 §3). */
export interface EditSourceResponse {
  image_id: string;
  /** The image row's `updated_at`, for the edit by sync (`touchedAt`). */
  updated_at: number;
  original_url: string;
  /** `images.edit_params` as stored. */
  edit_params: string | null;
  /** The newest `manual` mask of a photo edited by hand; otherwise the newest automatic one (device or home). */
  mask: { url: string; width: number | null; height: number | null } | null;
  /** The newest automatic `processed` and `thumb`, which "Restablecer" selects; null without them. */
  automatic: { processed_id: string; thumb_id: string } | null;
}
