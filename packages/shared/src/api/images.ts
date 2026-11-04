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

/** What the model is asked when the household writes nothing (10 §6.3). */
export const DEFAULT_AI_EDIT_PROMPT =
  'Foto de producto sobre fondo blanco, iluminación de estudio; no cambies el empaque, el texto ni los colores del producto.';

/** `POST /v1/images/:imageId/ai-edit` (10 §6.3): spends money, so it carries an explicit confirmation. */
export const AiEditRequestSchema = z.strictObject({
  prompt: z.string().trim().min(1).max(1000).optional(),
  confirm: z.literal(true),
});
export type AiEditRequest = z.infer<typeof AiEditRequestSchema>;

/** The new `processed` rendition (`tier='ai'`), its signed URL to show it and what the call cost. */
export interface AiEditResponse {
  rendition_id: string;
  url: string;
  cost_usd: number;
}

/**
 * `GET /v1/ai/image-edit` (10 §6.3): what one edit would cost and this month's spending, shown before confirming.
 * `reason` says why it is not available: no model chosen yet, or the month's budget would be passed.
 */
export interface AiEditQuote {
  available: boolean;
  reason: 'NOT_CONFIGURED' | 'BUDGET' | null;
  estimate_usd: number;
  spent_usd: number;
  budget_usd: number;
}
