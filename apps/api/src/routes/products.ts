import {
  CompareQuerySchema,
  ProductsQuerySchema,
  type ProductListItem,
  type ProductsResponse,
} from '@maunedas/shared/api/catalog';
import type { DisplayUnit } from '@maunedas/shared/pricing/units';
import { Hono } from 'hono';
import { z } from 'zod';
import { requireUser } from '../auth/middleware';
import { isBarcodeQuery, searchWords, sqlParams } from '../db/queries/params';
import { bestPrices, comparePrices, latestPoints } from '../db/queries/prices';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';
import { imageRefs } from '../images/refs';
import { decodeCursor, encodeCursor } from '../util/cursor';
import { parseParam, parseQuery } from '../util/validate';

type Row = Record<string, unknown>;

/** Product list, detail and comparator for the web (Android reads Room) — 03 §7. */
export const products = new Hono<AppEnv>()
  .get('/v1/products', requireUser(), async (c) => {
    const query = parseQuery(c, ProductsQuerySchema);
    const where = ['p.deleted_at IS NULL'];
    const { params, bind } = sqlParams();

    const words = searchWords(query.q);
    const barcode = isBarcodeQuery(query.q);
    if (words.length > 0 || barcode) {
      const text =
        words.length > 0 ? words.map((w) => `instr(p.search_key, ${bind(w)}) > 0`).join(' AND ') : '0';
      const code = barcode
        ? ` OR EXISTS (SELECT 1 FROM barcodes b JOIN variants v ON v.id = b.variant_id
                       WHERE v.product_id = p.id AND v.deleted_at IS NULL AND b.deleted_at IS NULL
                         AND b.code = ${bind(query.q!.trim())})`
        : '';
      where.push(`((${text})${code})`);
    }
    if (query.category_id) {
      where.push(`p.category_id IN (
        WITH RECURSIVE tree(id) AS (
          SELECT ${bind(query.category_id)}
          UNION SELECT c.id FROM categories c JOIN tree ON c.parent_id = tree.id WHERE c.deleted_at IS NULL)
        SELECT id FROM tree)`);
    }
    if (query.tag_id) {
      where.push(`EXISTS (SELECT 1 FROM product_tags pt WHERE pt.product_id = p.id AND pt.deleted_at IS NULL
                          AND pt.tag_id = ${bind(query.tag_id)})`);
    }
    if (query.cursor) {
      const [key, id] = decodeCursor(query.cursor, 2);
      where.push(`(p.search_key, p.id) > (${bind(String(key))}, ${bind(String(id))})`);
    }
    const sql = `SELECT p.id, p.name, p.brand, p.category_id, p.display_unit, p.primary_image_id, p.search_key,
                        (SELECT count(*) FROM variants v WHERE v.product_id = p.id AND v.deleted_at IS NULL) AS variants
                 FROM products p WHERE ${where.join(' AND ')}
                 ORDER BY p.search_key, p.id LIMIT ${bind(query.limit + 1)}`;
    const { results } = await c.env.DB.prepare(sql)
      .bind(...params)
      .all<{
        id: string;
        name: string;
        brand: string | null;
        category_id: string | null;
        display_unit: DisplayUnit;
        primary_image_id: string | null;
        search_key: string;
        variants: number;
      }>();

    const page = results.slice(0, query.limit);
    const now = Date.now();
    const [best, images] = await Promise.all([
      bestPrices(c.env.DB, page, now),
      imageRefs(
        c.env,
        page.map((p) => p.primary_image_id),
        now,
      ),
    ]);
    const items: ProductListItem[] = page.map((p) => ({
      id: p.id,
      name: p.name,
      brand: p.brand,
      category_id: p.category_id,
      display_unit: p.display_unit,
      image: (p.primary_image_id && images.get(p.primary_image_id)) || null,
      variants: p.variants,
      best: best.get(p.id) ?? null,
    }));
    const last = page.at(-1);
    const body: ProductsResponse = {
      items,
      next_cursor: results.length > query.limit && last ? encodeCursor([last.search_key, last.id]) : null,
    };
    return c.json(body);
  })

  .get('/v1/products/:id', requireUser(), async (c) => {
    const id = parseParam(c.req.param('id'), z.uuid(), 'id');
    const db = c.env.DB;
    const [product, tags, variants, barcodes] = await db.batch<Row>([
      db.prepare('SELECT * FROM products WHERE id = ?1 AND deleted_at IS NULL').bind(id),
      db
        .prepare(
          `SELECT t.* FROM product_tags pt JOIN tags t ON t.id = pt.tag_id
           WHERE pt.product_id = ?1 AND pt.deleted_at IS NULL AND t.deleted_at IS NULL ORDER BY t.name, t.id`,
        )
        .bind(id),
      db
        .prepare('SELECT * FROM variants WHERE product_id = ?1 AND deleted_at IS NULL ORDER BY label, id')
        .bind(id),
      db
        .prepare(
          `SELECT b.id, b.variant_id, b.code, b.updated_at FROM barcodes b JOIN variants v ON v.id = b.variant_id
           WHERE v.product_id = ?1 AND b.deleted_at IS NULL ORDER BY b.code`,
        )
        .bind(id),
    ]);
    const p = product!.results[0];
    if (!p) throw new ApiError(404, 'NOT_FOUND');

    const variantRows = variants!.results;
    const unit = p.display_unit as DisplayUnit;
    const [latest, images] = await Promise.all([
      latestPoints(
        db,
        unit,
        variantRows.map((v) => String(v.id)),
      ),
      imageRefs(c.env, [
        p.primary_image_id as string | null,
        ...variantRows.map((v) => v.primary_image_id as string | null),
      ]),
    ]);
    const rowsOf = (variantId: unknown) => barcodes!.results.filter((b) => b.variant_id === variantId);

    return c.json({
      product: {
        ...p,
        tags: tags!.results,
        image: (p.primary_image_id && images.get(String(p.primary_image_id))) || null,
      },
      variants: variantRows.map((v) => ({
        ...v,
        barcodes: rowsOf(v.id).map((b) => String(b.code)),
        // The web edits codes by push: removing one is its row's tombstone (T-161).
        barcode_rows: rowsOf(v.id).map((b) => ({ id: b.id, code: b.code, updated_at: b.updated_at })),
        image: (v.primary_image_id && images.get(String(v.primary_image_id))) || null,
        latest: latest.get(String(v.id)) ?? [],
      })),
    });
  })

  .get('/v1/products/:id/compare', requireUser(), async (c) => {
    const id = parseParam(c.req.param('id'), z.uuid(), 'id');
    const { days } = parseQuery(c, CompareQuerySchema);
    const product = await c.env.DB.prepare(
      'SELECT display_unit FROM products WHERE id = ?1 AND deleted_at IS NULL',
    )
      .bind(id)
      .first<{ display_unit: DisplayUnit }>();
    if (!product) throw new ApiError(404, 'NOT_FOUND');
    return c.json(await comparePrices(c.env.DB, id, product.display_unit, days, Date.now()));
  });
