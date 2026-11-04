import type { HaVariantsResponse } from '@maunedas/shared/api/ha';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';
import { requireHaToken } from '../ha/auth';
import { haVariant } from '../ha/variant';
import { parseParam } from '../util/validate';

/** Home Assistant's read-only API (T-308, 03 §13): only GETs, behind its own token. */
export const ha = new Hono<AppEnv>()
  .get('/ha/v1/variants', requireHaToken, async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT v.id AS variant_id, p.name || ' · ' || v.label AS name
       FROM variants v JOIN products p ON p.id = v.product_id
       WHERE v.deleted_at IS NULL AND p.deleted_at IS NULL
       ORDER BY p.name COLLATE NOCASE, v.label COLLATE NOCASE, v.id`,
    ).all<{ variant_id: string; name: string }>();
    return c.json<HaVariantsResponse>({ items: results });
  })
  .get('/ha/v1/variants/:id', requireHaToken, async (c) => {
    const id = parseParam(c.req.param('id'), z.uuid(), 'id');
    const variant = await haVariant(c.env.DB, id, Date.now());
    if (!variant) throw new ApiError(404, 'NOT_FOUND');
    return c.json(variant);
  });
