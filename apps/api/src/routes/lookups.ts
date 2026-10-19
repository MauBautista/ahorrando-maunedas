import { Hono } from 'hono';
import { requireUser } from '../auth/middleware';
import type { AppEnv } from '../env';

type Row = Record<string, unknown>;

/** `GET /v1/lookups` (03 §7): live stores, branches, categories and tags for the web. */
export const lookups = new Hono<AppEnv>().get('/v1/lookups', requireUser(), async (c) => {
  const db = c.env.DB;
  const [stores, branches, categories, tags] = await db.batch<Row>([
    db.prepare('SELECT * FROM stores WHERE deleted_at IS NULL ORDER BY name, id'),
    db.prepare('SELECT * FROM store_branches WHERE deleted_at IS NULL ORDER BY store_id, name, id'),
    db.prepare('SELECT * FROM categories WHERE deleted_at IS NULL ORDER BY sort_order, name, id'),
    db.prepare('SELECT * FROM tags WHERE deleted_at IS NULL ORDER BY name, id'),
  ]);
  return c.json({
    stores: stores!.results,
    store_branches: branches!.results,
    categories: categories!.results,
    tags: tags!.results,
  });
});
