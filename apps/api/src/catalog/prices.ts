import type { BestPrice, LatestPoint, PriceSource } from '@maunedas/shared/api/catalog';
import {
  BASE_PER_DISPLAY,
  defaultDisplayUnit,
  displayCents,
  type DisplayUnit,
  type Measure,
} from '@maunedas/shared/pricing/units';

/** Window of the "best price" rule (03 §3). */
export const BEST_PRICE_DAYS = 90;

interface PointRow {
  point_id: string;
  variant_id: string;
  product_id: string;
  label: string;
  measure: Measure;
  store_id: string;
  source: PriceSource;
  observed_at: number;
  effective_unit_cents: number;
  cents_per_base: number;
}

const fits = (unit: DisplayUnit, measure: Measure) => BASE_PER_DISPLAY[unit].measure === measure;

/** Unit to show a variant in: the product's, or the default one of its measure when they differ. */
export function unitFor(productUnit: DisplayUnit, measure: Measure): DisplayUnit {
  return fits(productUnit, measure) ? productUnit : defaultDisplayUnit(measure);
}

/** Newest point per key; ties on observed_at keep the greatest point id (deterministic). */
function newestBy(points: PointRow[], key: (p: PointRow) => string): Map<string, PointRow> {
  const out = new Map<string, PointRow>();
  for (const p of points) {
    const k = key(p);
    const cur = out.get(k);
    if (
      !cur ||
      p.observed_at > cur.observed_at ||
      (p.observed_at === cur.observed_at && p.point_id > cur.point_id)
    ) {
      out.set(k, p);
    }
  }
  return out;
}

/**
 * Best price per product (03 §3): newest point of the last 90 days per (variant, store), whatever the
 * source; the lowest cents_per_base wins. Deleted variants and variants whose measure does not fit the
 * product's display unit do not compete.
 */
export async function bestPrices(
  db: D1Database,
  products: ReadonlyArray<{ id: string; display_unit: DisplayUnit }>,
  now: number,
): Promise<Map<string, BestPrice | null>> {
  const result = new Map<string, BestPrice | null>(products.map((p) => [p.id, null]));
  if (products.length === 0) return result;
  const { results } = await db
    .prepare(
      `SELECT pp.point_id, pp.variant_id, v.product_id, v.label, v.measure, pp.store_id, pp.source,
              pp.observed_at, pp.effective_unit_cents, pp.cents_per_base
       FROM v_price_points pp JOIN variants v ON v.id = pp.variant_id
       WHERE v.deleted_at IS NULL AND pp.observed_at >= ?2
         AND v.product_id IN (SELECT value FROM json_each(?1))`,
    )
    .bind(JSON.stringify(products.map((p) => p.id)), now - BEST_PRICE_DAYS * 86_400_000)
    .all<PointRow>();

  const unitOf = new Map(products.map((p) => [p.id, p.display_unit]));
  for (const p of newestBy(results, (r) => `${r.variant_id}:${r.store_id}`).values()) {
    const unit = unitOf.get(p.product_id)!;
    if (!fits(unit, p.measure)) continue;
    const display = displayCents(p.cents_per_base, p.measure, unit);
    const best = result.get(p.product_id);
    if (!best || display < best.display_cents) {
      result.set(p.product_id, {
        variant_id: p.variant_id,
        variant_label: p.label,
        display_cents: display,
        display_unit: unit,
        store_id: p.store_id,
        source: p.source,
        observed_at: p.observed_at,
      });
    }
  }
  return result;
}

/** Newest point per (store, source) of each variant, without time window (product detail, 03 §7). */
export async function latestPoints(
  db: D1Database,
  productUnit: DisplayUnit,
  variantIds: string[],
): Promise<Map<string, LatestPoint[]>> {
  const out = new Map<string, LatestPoint[]>(variantIds.map((id) => [id, []]));
  if (variantIds.length === 0) return out;
  const { results } = await db
    .prepare(
      `SELECT pp.point_id, pp.variant_id, v.product_id, v.label, v.measure, pp.store_id, pp.source,
              pp.observed_at, pp.effective_unit_cents, pp.cents_per_base
       FROM v_price_points pp JOIN variants v ON v.id = pp.variant_id
       WHERE pp.variant_id IN (SELECT value FROM json_each(?1))`,
    )
    .bind(JSON.stringify(variantIds))
    .all<PointRow>();
  const newest = [...newestBy(results, (r) => `${r.variant_id}:${r.store_id}:${r.source}`).values()];
  newest.sort((a, b) => b.observed_at - a.observed_at);
  for (const p of newest) {
    const unit = unitFor(productUnit, p.measure);
    out.get(p.variant_id)!.push({
      store_id: p.store_id,
      source: p.source,
      effective_unit_cents: p.effective_unit_cents,
      display_cents: displayCents(p.cents_per_base, p.measure, unit),
      display_unit: unit,
      observed_at: p.observed_at,
    });
  }
  return out;
}
