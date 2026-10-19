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
