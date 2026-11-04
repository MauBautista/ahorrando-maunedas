import type { HaPrice, HaVariant } from '@maunedas/shared/api/ha';
import { displayCents, type DisplayUnit, type Measure } from '@maunedas/shared/pricing/units';
import {
  BEST_PRICE_DAYS,
  DAY_MS,
  isNewer,
  pickBest,
  POINTS_SQL,
  type PricePoint,
  unitFor,
} from '../db/queries/prices';

/**
 * What Home Assistant reads of one variant (T-308, 03 §13), or null when it does not exist or was deleted.
 * `current` is the best-price rule of 03 §3 over this variant alone; `lowest` looks at every point ever seen.
 */
export async function haVariant(db: D1Database, variantId: string, now: number): Promise<HaVariant | null> {
  const [variant, points, stores, listings] = await db.batch<Record<string, unknown>>([
    db
      .prepare(
        `SELECT v.id, v.label, v.measure, p.name AS product_name, p.display_unit
         FROM variants v JOIN products p ON p.id = v.product_id
         WHERE v.id = ?1 AND v.deleted_at IS NULL AND p.deleted_at IS NULL`,
      )
      .bind(variantId),
    db.prepare(`${POINTS_SQL} WHERE pp.variant_id = ?1`).bind(variantId),
    db.prepare('SELECT id, name FROM stores'),
    db
      .prepare(
        `SELECT s.name AS store, st.last_price_cents, st.last_in_stock, st.last_status, st.last_checked_at
         FROM listings l JOIN stores s ON s.id = l.store_id LEFT JOIN listing_state st ON st.listing_id = l.id
         WHERE l.variant_id = ?1 AND l.deleted_at IS NULL AND l.active = 1
         ORDER BY s.name, l.id`,
      )
      .bind(variantId),
  ]);
  const v = variant!.results[0] as
    | { id: string; label: string; measure: Measure; product_name: string; display_unit: DisplayUnit }
    | undefined;
  if (!v) return null;
  const unit = unitFor(v.display_unit, v.measure);
  const storeName = new Map(
    (stores!.results as Array<{ id: string; name: string }>).map((s) => [s.id, s.name]),
  );
  const price = (p: PricePoint | null): HaPrice | null =>
    p && {
      price_cents: p.effective_unit_cents,
      display_cents: displayCents(p.cents_per_base, p.measure, unit),
      store: storeName.get(p.store_id) ?? '',
      source: p.source,
      observed_at: p.observed_at,
    };

  const all = points!.results as unknown as PricePoint[];
  const latestByStore = new Map<string, PricePoint>();
  for (const p of all) {
    if (p.observed_at < now - BEST_PRICE_DAYS * DAY_MS) continue;
    const seen = latestByStore.get(p.store_id);
    if (!seen || isNewer(p, seen)) latestByStore.set(p.store_id, p);
  }
  const lowest = all.reduce<PricePoint | null>(
    (a, b) =>
      !a || b.cents_per_base < a.cents_per_base || (b.cents_per_base === a.cents_per_base && isNewer(b, a))
        ? b
        : a,
    null,
  );

  const rows = listings!.results as Array<{
    store: string;
    last_price_cents: number | null;
    last_in_stock: number | null;
    last_status: string | null;
    last_checked_at: number | null;
  }>;
  const stock = rows.map((r) => r.last_in_stock).filter((s): s is number => s !== null);
  return {
    variant_id: v.id,
    name: `${v.product_name} · ${v.label}`,
    display_unit: unit,
    current: price(pickBest(latestByStore.values(), unit)),
    lowest: price(lowest),
    in_stock: stock.length === 0 ? null : stock.includes(1),
    listings: rows.map((r) => ({
      store: r.store,
      price_cents: r.last_price_cents,
      in_stock: r.last_in_stock === null ? null : r.last_in_stock === 1,
      status: r.last_status,
      checked_at: r.last_checked_at,
    })),
  };
}
