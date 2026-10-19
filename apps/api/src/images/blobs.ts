import { ApiError } from '../errors';

/** Blob names of 10 §4.1: the original, or a rendition id with its extension. */
const NAME = /^(original\.(jpg|png|webp)|[0-9a-f-]{36}\.(webp|png))$/;
const TYPES = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' } as const;

export interface BlobName {
  name: string;
  /** The rendition id, or null for the original. */
  renditionId: string | null;
  contentType: (typeof TYPES)[keyof typeof TYPES];
}

export function parseBlobName(name: string): BlobName {
  if (!NAME.test(name)) {
    throw new ApiError(400, 'VALIDATION_ERROR', {
      reason: 'INVALID_NAME',
      issues: [
        {
          path: ['name'],
          code: 'invalid_format',
          message: 'original.(jpg|png|webp) o <renditionId>.(webp|png)',
        },
      ],
    });
  }
  const [base, ext] = name.split('.') as [string, keyof typeof TYPES];
  return { name, renditionId: base === 'original' ? null : base, contentType: TYPES[ext] };
}

/** R2 keys are immutable (10 §1): `images/{imageId}/{name}`. */
export const blobKey = (imageId: string, name: string) => `images/${imageId}/${name}`;

/** Base media type of a Content-Type header, lowercase. */
export const mediaType = (header: string | null | undefined) =>
  (header ?? '').split(';')[0]!.trim().toLowerCase();
