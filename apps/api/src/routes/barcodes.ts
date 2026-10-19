import { normalizeBarcode, type BarcodeLookupResponse } from '@maunedas/shared/api/barcodes';
import { Hono } from 'hono';
import { requireUser } from '../auth/middleware';
import { lookupOpenCatalog } from '../catalog/off';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';

/** `GET /v1/barcodes/:code` (03 §8, 10 §2.1): our catalog first, then the open catalogs. */
export const barcodes = new Hono<AppEnv>().get('/v1/barcodes/:code', requireUser(), async (c) => {
  const code = normalizeBarcode(c.req.param('code'));
  if (!code) throw new ApiError(400, 'INVALID_BARCODE');

  const match = await c.env.DB.prepare(
    `SELECT b.variant_id, v.product_id, p.name AS product_name, v.label AS variant_label
     FROM barcodes b JOIN variants v ON v.id = b.variant_id JOIN products p ON p.id = v.product_id
     WHERE b.code = ?1 AND b.deleted_at IS NULL AND v.deleted_at IS NULL AND p.deleted_at IS NULL
     LIMIT 1`,
  )
    .bind(code)
    .first<NonNullable<BarcodeLookupResponse['match']>>();

  const body: BarcodeLookupResponse = {
    code,
    match: match ?? null,
    catalog: match
      ? null
      : await lookupOpenCatalog(c.env.DB, code, {
          fetch: c.get('outboundFetch'),
          userAgent: c.env.OFF_USER_AGENT,
          now: Date.now(),
          requestId: c.get('requestId'),
        }),
  };
  return c.json(body);
});
