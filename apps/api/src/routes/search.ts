import { SearchVariantsQuerySchema, type VariantSearchItem } from '@maunedas/shared/api/catalog';
import type { DisplayUnit, Measure } from '@maunedas/shared/pricing/units';
import { Hono } from 'hono';
import { requireUser } from '../auth/middleware';
import { isBarcodeQuery, searchWords, sqlParams } from '../db/queries/params';
import { unitFor } from '../db/queries/prices';
import type { AppEnv } from '../env';
import { imageRefs } from '../images/refs';
import { parseQuery } from '../util/validate';

/** `GET /v1/search/variants` (03 §7): for the purchase editor and receipt review on the web. */
export const search = new Hono<AppEnv>().get('/v1/search/variants', requireUser(), async (c) => {
  const query = parseQuery(c, SearchVariantsQuerySchema);
  const { params, bind } = sqlParams();
  const words = searchWords(query.q);
  const codeMatch = isBarcodeQuery(query.q)
    ? `EXISTS (SELECT 1 FROM barcodes b WHERE b.variant_id = v.id AND b.deleted_at IS NULL AND b.code = ${bind(query.q)})`
    : '0';
  const text =
    words.length > 0
      ? words.map((w) => `instr(p.search_key || ' ' || lower(v.label), ${bind(w)}) > 0`).join(' AND ')
      : '0';
  // S-05: the newest list price at the purchase's store, as Android's `lastListPrice`.
  const lastPrice = query.store_id
    ? `(SELECT pp.list_unit_cents FROM v_price_points pp WHERE pp.variant_id = v.id AND pp.store_id = ${bind(query.store_id)}
        ORDER BY pp.observed_at DESC, pp.point_id DESC LIMIT 1)`
    : 'NULL';
  const sql = `SELECT v.id AS variant_id, p.id AS product_id, p.name AS product_name, p.brand, v.label AS variant_label,
                      v.primary_image_id AS variant_image, p.primary_image_id AS product_image,
                      v.measure, v.unit_amount, v.pack_count, v.sold_by_weight, p.display_unit,
                      ${lastPrice} AS last_unit_cents,
                      (${codeMatch}) AS barcode_match
               FROM variants v JOIN products p ON p.id = v.product_id
               WHERE v.deleted_at IS NULL AND p.deleted_at IS NULL AND ((${codeMatch}) OR (${text}))
               ORDER BY barcode_match DESC, p.search_key, v.label, v.id LIMIT ${bind(query.limit)}`;
  const { results } = await c.env.DB.prepare(sql)
    .bind(...params)
    .all<{
      variant_id: string;
      product_id: string;
      product_name: string;
      brand: string | null;
      variant_label: string;
      variant_image: string | null;
      product_image: string | null;
      measure: Measure;
      unit_amount: number;
      pack_count: number;
      sold_by_weight: number;
      display_unit: DisplayUnit;
      last_unit_cents: number | null;
      barcode_match: number;
    }>();
  const images = await imageRefs(
    c.env,
    results.flatMap((r) => [r.variant_image, r.product_image]),
  );
  const items: VariantSearchItem[] = results.map((r) => ({
    variant_id: r.variant_id,
    product_id: r.product_id,
    product_name: r.product_name,
    brand: r.brand,
    variant_label: r.variant_label,
    barcode_match: r.barcode_match === 1,
    measure: r.measure,
    unit_amount: r.unit_amount,
    pack_count: r.pack_count,
    sold_by_weight: r.sold_by_weight === 1,
    display_unit: unitFor(r.display_unit, r.measure),
    last_unit_cents: r.last_unit_cents,
    image: images.get(r.variant_image ?? '') ?? images.get(r.product_image ?? '') ?? null,
  }));
  return c.json({ items });
});
