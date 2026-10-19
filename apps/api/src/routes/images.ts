import { ImportImageRequestSchema, MAX_UPLOAD_BYTES, type BlobResponse } from '@maunedas/shared/api/images';
import { Hono, type MiddlewareHandler } from 'hono';
import { z } from 'zod';
import { requireUser } from '../auth/middleware';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';
import { blobKey, mediaType, parseBlobName } from '../images/blobs';
import { fetchCatalogImage } from '../images/import';
import { verifySigned } from '../images/signing';
import { parseJsonBody, parseParam } from '../util/validate';

const IMMUTABLE = 'private, max-age=31536000, immutable';
const ORIGINAL_KEY = /^images\/[0-9a-f-]{36}\/original\.(jpg|png|webp)$/;

/** Blob downloads accept a Bearer token or a signed URL (`?exp=&sig=`, 10 §3). */
const signedOrUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const exp = c.req.query('exp');
  const sig = c.req.query('sig');
  if (exp === undefined && sig === undefined) return requireUser()(c, next);
  if (!(await verifySigned(c.env.IMAGE_URL_SECRET, c.req.path, exp, sig))) {
    throw new ApiError(401, 'INVALID_SIGNATURE');
  }
  await next();
};

/** Image blobs in R2 (10 §2.3, §4.1). Rows travel by sync first; binaries come after. */
export const images = new Hono<AppEnv>()
  .put('/v1/images/:imageId/blobs/:name', requireUser(), async (c) => {
    const imageId = parseParam(c.req.param('imageId'), z.uuid(), 'imageId');
    const blob = parseBlobName(c.req.param('name'));
    const contentType = mediaType(c.req.header('Content-Type'));
    if (contentType !== blob.contentType) throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE');
    const length = Number(c.req.header('Content-Length'));
    if (length > MAX_UPLOAD_BYTES) throw new ApiError(413, 'PAYLOAD_TOO_LARGE');
    const body = c.req.raw.body;
    if (!Number.isInteger(length) || length <= 0 || !body) {
      throw new ApiError(400, 'VALIDATION_ERROR', { reason: 'CONTENT_LENGTH_REQUIRED' });
    }

    // The row must exist (pushed before) and point at this exact key; clients upload only their own tiers.
    const key = blobKey(imageId, blob.name);
    const owner = blob.renditionId
      ? c.env.DB.prepare(
          `SELECT 1 FROM image_renditions
           WHERE id = ?1 AND image_id = ?2 AND r2_key = ?3 AND tier IN ('device', 'manual') AND deleted_at IS NULL`,
        ).bind(blob.renditionId, imageId, key)
      : c.env.DB.prepare(
          'SELECT 1 FROM images WHERE id = ?1 AND original_key = ?2 AND deleted_at IS NULL',
        ).bind(imageId, key);
    if (!(await owner.first())) {
      await body.cancel();
      throw new ApiError(409, 'IMAGE_NOT_FOUND');
    }

    // Keys are immutable: the first upload wins and a retry answers the same.
    const existing = await c.env.IMAGES.head(key);
    if (existing) {
      await body.cancel();
      return c.json<BlobResponse>({ key, bytes: existing.size }, 201);
    }
    await c.env.IMAGES.put(key, body.pipeThrough(new FixedLengthStream(length)), {
      httpMetadata: { contentType },
    });
    return c.json<BlobResponse>({ key, bytes: length }, 201);
  })

  .get('/v1/images/:imageId/blobs/:name', signedOrUser, async (c) => {
    const imageId = parseParam(c.req.param('imageId'), z.uuid(), 'imageId');
    const blob = parseBlobName(c.req.param('name'));
    const object = await c.env.IMAGES.get(blobKey(imageId, blob.name), { onlyIf: c.req.raw.headers });
    if (!object) throw new ApiError(404, 'NOT_FOUND');
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('ETag', object.httpEtag);
    headers.set('Cache-Control', IMMUTABLE);
    if (!('body' in object)) return new Response(null, { status: 304, headers });
    headers.set('Content-Length', String(object.size));
    return new Response(object.body, { headers });
  })

  .post('/v1/images/:imageId/import', requireUser(), async (c) => {
    const imageId = parseParam(c.req.param('imageId'), z.uuid(), 'imageId');
    const { source_url } = await parseJsonBody(c, ImportImageRequestSchema);
    const row = await c.env.DB.prepare('SELECT original_key FROM images WHERE id = ?1 AND deleted_at IS NULL')
      .bind(imageId)
      .first<{ original_key: string | null }>();
    const key = row?.original_key;
    if (!key || !ORIGINAL_KEY.test(key) || !key.startsWith(`images/${imageId}/`)) {
      throw new ApiError(409, 'IMAGE_NOT_FOUND');
    }

    const existing = await c.env.IMAGES.head(key);
    if (existing) return c.json<BlobResponse>({ key, bytes: existing.size }, 201);
    const { bytes, contentType } = await fetchCatalogImage(
      c.get('outboundFetch'),
      source_url,
      c.env.OFF_USER_AGENT,
    );
    await c.env.IMAGES.put(key, bytes, { httpMetadata: { contentType } });
    return c.json<BlobResponse>({ key, bytes: bytes.byteLength }, 201);
  });
