import {
  PurchasesQuerySchema,
  type PurchaseDetailItem,
  type PurchaseDetailResponse,
  type PurchaseListItem,
  type PurchasesResponse,
} from '@maunedas/shared/api/purchases';
import { prorateTicketDiscount } from '@maunedas/shared/pricing/ticketDiscount';
import { centsPerBase, displayCents, type DisplayUnit, type Measure } from '@maunedas/shared/pricing/units';
import { Hono } from 'hono';
import { z } from 'zod';
import { requireUser } from '../auth/middleware';
import { sqlParams } from '../db/queries/params';
import { unitFor } from '../db/queries/prices';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';
import { imageRefs } from '../images/refs';
import { decodeCursor, encodeCursor } from '../util/cursor';
import { parseParam, parseQuery } from '../util/validate';

type Row = Record<string, unknown>;

interface ItemRow extends Row {
  id: string;
  quantity: number;
  final_cents: number;
  product_id: string | null;
  product_name: string | null;
  variant_label: string | null;
  product_display_unit: DisplayUnit | null;
  measure: Measure | null;
  unit_amount: number | null;
  pack_count: number | null;
}

/** Purchases for the web (Android reads Room) — 03 §7. Shared by the household, like the rest of the data. */
export const purchases = new Hono<AppEnv>()
  .get('/v1/purchases', requireUser(), async (c) => {
    const query = parseQuery(c, PurchasesQuerySchema);
    if (query.from !== undefined && query.to !== undefined && query.from > query.to) {
      throw new ApiError(400, 'VALIDATION_ERROR', {
        issues: [
          { path: ['from'], code: 'invalid_range', message: '`from` debe ser menor o igual que `to`' },
        ],
      });
    }
    const where = ['p.deleted_at IS NULL'];
    const { params, bind } = sqlParams();
    if (query.from !== undefined) where.push(`p.purchased_at >= ${bind(query.from)}`);
    if (query.to !== undefined) where.push(`p.purchased_at <= ${bind(query.to)}`);
    if (query.store_id) where.push(`p.store_id = ${bind(query.store_id)}`);
    if (query.status) where.push(`p.status = ${bind(query.status)}`);
    if (query.cursor) {
      const [at, id] = decodeCursor(query.cursor, 2);
      where.push(`(p.purchased_at, p.id) < (${bind(Number(at))}, ${bind(String(id))})`);
    }
    const sql = `SELECT p.id, p.store_id, p.branch_id, p.purchased_at, p.status, p.source, p.total_cents,
                        COALESCE(l.total, 0) AS lines_total_cents, COALESCE(l.n, 0) AS lines,
                        (SELECT count(*) FROM images im
                         WHERE im.owner_type = 'purchase' AND im.owner_id = p.id AND im.role = 'receipt'
                           AND im.deleted_at IS NULL) AS receipt_pages
                 FROM purchases p
                 LEFT JOIN (SELECT purchase_id, SUM(final_cents) AS total, count(*) AS n FROM purchase_items
                            WHERE deleted_at IS NULL GROUP BY purchase_id) l ON l.purchase_id = p.id
                 WHERE ${where.join(' AND ')}
                 ORDER BY p.purchased_at DESC, p.id DESC LIMIT ${bind(query.limit + 1)}`;
    const { results } = await c.env.DB.prepare(sql)
      .bind(...params)
      .all<PurchaseListItem>();
    const items = results.slice(0, query.limit);
    const last = items.at(-1);
    const body: PurchasesResponse = {
      items,
      next_cursor: results.length > query.limit && last ? encodeCursor([last.purchased_at, last.id]) : null,
    };
    return c.json(body);
  })

  .get('/v1/purchases/:id', requireUser(), async (c) => {
    const id = parseParam(c.req.param('id'), z.uuid(), 'id');
    const db = c.env.DB;
    const [purchase, items, promotions, receipts] = await db.batch<Row>([
      db.prepare('SELECT * FROM purchases WHERE id = ?1 AND deleted_at IS NULL').bind(id),
      db
        .prepare(
          `SELECT pi.*, v.product_id, pr.name AS product_name, v.label AS variant_label,
                  pr.display_unit AS product_display_unit, v.measure, v.unit_amount, v.pack_count
           FROM purchase_items pi
           LEFT JOIN variants v ON v.id = pi.variant_id
           LEFT JOIN products pr ON pr.id = v.product_id
           WHERE pi.purchase_id = ?1 AND pi.deleted_at IS NULL
           ORDER BY pi.line_no, pi.id`,
        )
        .bind(id),
      db
        .prepare(
          `SELECT * FROM promotions
           WHERE deleted_at IS NULL
             AND (purchase_id = ?1 OR purchase_item_id IN
                  (SELECT id FROM purchase_items WHERE purchase_id = ?1 AND deleted_at IS NULL))
           ORDER BY created_at, id`,
        )
        .bind(id),
      db
        .prepare(
          `SELECT id FROM images
           WHERE owner_type = 'purchase' AND owner_id = ?1 AND role = 'receipt' AND deleted_at IS NULL
           ORDER BY created_at, id`,
        )
        .bind(id),
    ]);
    const p = purchase!.results[0];
    if (!p) throw new ApiError(404, 'NOT_FOUND');

    // Same prorating as v_price_points, so drafts show the price they will have once confirmed.
    const lines = items!.results as ItemRow[];
    const paid = prorateTicketDiscount(
      lines.map((l) => l.final_cents),
      Number(p.discount_cents),
    );
    const receiptIds = receipts!.results.map((r) => String(r.id));
    const refs = await imageRefs(c.env, receiptIds);

    const body: PurchaseDetailResponse = {
      purchase: p as PurchaseDetailResponse['purchase'],
      items: lines.map((line, i): PurchaseDetailItem => {
        const { product_display_unit: productUnit, measure, unit_amount, pack_count, ...row } = line;
        const linked =
          productUnit !== null && measure !== null && unit_amount !== null && pack_count !== null;
        const unit = linked ? unitFor(productUnit, measure) : null;
        return {
          ...row,
          display_unit: unit,
          display_cents:
            linked && unit
              ? displayCents(centsPerBase(paid[i]!, line.quantity, unit_amount, pack_count), measure, unit)
              : null,
        };
      }),
      promotions: promotions!.results,
      receipt_images: receiptIds.flatMap((r) => refs.get(r) ?? []),
    };
    return c.json(body);
  });
