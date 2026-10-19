import {
  HISTORY_DEFAULT_DAYS,
  HistoryQuerySchema,
  type HistoryPoint,
  type HistoryResponse,
} from '@maunedas/shared/api/catalog';
import { displayCents, type DisplayUnit, type Measure } from '@maunedas/shared/pricing/units';
import { Hono } from 'hono';
import { z } from 'zod';
import { requireUser } from '../auth/middleware';
import { DAY_MS, POINTS_SQL, unitFor, type PricePoint } from '../db/queries/prices';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';
import { parseParam, parseQuery } from '../util/validate';

type Row = Record<string, unknown>;

/** `GET /v1/variants/:id/history` (03 §7): every price point of a variant in a time range, oldest first. */
export const variants = new Hono<AppEnv>().get('/v1/variants/:id/history', requireUser(), async (c) => {
  const id = parseParam(c.req.param('id'), z.uuid(), 'id');
  const query = parseQuery(c, HistoryQuerySchema);
  const to = query.to ?? Date.now();
  const from = query.from ?? to - HISTORY_DEFAULT_DAYS * DAY_MS;
  if (from > to) {
    throw new ApiError(400, 'VALIDATION_ERROR', {
      issues: [{ path: ['from'], code: 'invalid_range', message: '`from` debe ser menor o igual que `to`' }],
    });
  }

  const db = c.env.DB;
  const [variant, points, listings] = await db.batch<Row>([
    db
      .prepare(
        `SELECT v.*, p.name AS product_name, p.display_unit AS product_display_unit
         FROM variants v JOIN products p ON p.id = v.product_id
         WHERE v.id = ?1 AND v.deleted_at IS NULL AND p.deleted_at IS NULL`,
      )
      .bind(id),
    db
      .prepare(
        `${POINTS_SQL}
         WHERE pp.variant_id = ?1 AND pp.observed_at BETWEEN ?3 AND ?4
           AND pp.source IN (SELECT value FROM json_each(?5)) AND (?2 IS NULL OR pp.store_id = ?2)
         ORDER BY pp.observed_at, pp.point_id`,
      )
      .bind(id, query.store_id ?? null, from, to, JSON.stringify(query.sources)),
    db
      .prepare(
        `SELECT l.id, s.last_checked_at FROM listings l JOIN listing_state s ON s.listing_id = l.id
         WHERE l.variant_id = ?1 AND l.deleted_at IS NULL AND s.last_checked_at IS NOT NULL AND (?2 IS NULL OR l.store_id = ?2)`,
      )
      .bind(id, query.store_id ?? null),
  ]);
  const v = variant!.results[0];
  if (!v) throw new ApiError(404, 'NOT_FOUND');

  const { product_display_unit: productUnit, ...variantRow } = v;
  const unit = unitFor(productUnit as DisplayUnit, v.measure as Measure);
  const body: HistoryResponse = {
    variant: variantRow as HistoryResponse['variant'],
    display_unit: unit,
    points: (points!.results as unknown as PricePoint[]).map((p): HistoryPoint => ({
      source: p.source,
      point_id: p.point_id,
      store_id: p.store_id,
      branch_id: p.branch_id,
      listing_id: p.listing_id,
      observed_at: p.observed_at,
      list_unit_cents: p.list_unit_cents,
      effective_unit_cents: p.effective_unit_cents,
      display_cents: displayCents(p.cents_per_base, p.measure, unit),
      has_promo: p.has_promo === 1,
    })),
    web_confirmed_until: Object.fromEntries(
      listings!.results.map((l) => [String(l.id), Number(l.last_checked_at)]),
    ),
  };
  return c.json(body);
});
