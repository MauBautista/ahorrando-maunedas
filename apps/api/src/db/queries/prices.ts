import type {
  BestPrice,
  CompareResponse,
  CompareRow,
  LatestPoint,
  PriceSource,
} from '@maunedas/shared/api/catalog';
import {
  BASE_PER_DISPLAY,
  defaultDisplayUnit,
  displayCents,
  type DisplayUnit,
  type Measure,
} from '@maunedas/shared/pricing/units';

/** Window of the "best price" rule (03 §3). */
export const BEST_PRICE_DAYS = 90;
export const DAY_MS = 86_400_000;

/** A row of `v_price_points` with its variant. */
export interface PricePoint {
  source: PriceSource;
  point_id: string;
  variant_id: string;
  product_id: string;
  label: string;
  measure: Measure;
  store_id: string;
  branch_id: string | null;
  listing_id: string | null;
  observed_at: number;
  list_unit_cents: number;
  effective_unit_cents: number;
  cents_per_base: number;
  has_promo: number;
}

export const POINTS_SQL = `SELECT pp.source, pp.point_id, pp.variant_id, v.product_id, v.label, v.measure, pp.store_id,
       pp.branch_id, pp.listing_id, pp.observed_at, pp.list_unit_cents, pp.effective_unit_cents,
       pp.cents_per_base, pp.has_promo
FROM v_price_points pp JOIN variants v ON v.id = pp.variant_id`;

const fits = (unit: DisplayUnit, measure: Measure) => BASE_PER_DISPLAY[unit].measure === measure;

/** Unit to show a variant in: the product's, or the default one of its measure when they differ (03 §3). */
export function unitFor(productUnit: DisplayUnit, measure: Measure): DisplayUnit {
  return fits(productUnit, measure) ? productUnit : defaultDisplayUnit(measure);
}

/** Newer point first; ties on observed_at go to the greatest point id, so results are deterministic. */
const isNewer = (a: PricePoint, b: PricePoint) =>
  a.observed_at > b.observed_at || (a.observed_at === b.observed_at && a.point_id > b.point_id);

function groupBy(points: PricePoint[], key: (p: PricePoint) => string): Map<string, PricePoint[]> {
  const groups = new Map<string, PricePoint[]>();
  for (const p of points) {
    const k = key(p);
    const group = groups.get(k);
    if (group) group.push(p);
    else groups.set(k, [p]);
  }
  return groups;
}

const newest = (group: PricePoint[]) => group.reduce((a, b) => (isNewer(b, a) ? b : a));
const byVariantStore = (p: PricePoint) => `${p.variant_id}:${p.store_id}`;

/**
 * The best-price rule (03 §3), shared by the product list and the comparator: among the newest point of
 * each (variant, store), the lowest cents_per_base of a variant whose measure fits the product's unit.
 * Ties go to the newer point.
 */
export function pickBest(lastPoints: Iterable<PricePoint>, unit: DisplayUnit): PricePoint | null {
  let best: PricePoint | null = null;
  for (const p of lastPoints) {
    if (!fits(unit, p.measure)) continue;
    if (
      !best ||
      p.cents_per_base < best.cents_per_base ||
      (p.cents_per_base === best.cents_per_base && isNewer(p, best))
    ) {
      best = p;
    }
  }
  return best;
}

/** Best price of each product over the last 90 days (03 §3); deleted variants do not compete. */
export async function bestPrices(
  db: D1Database,
  products: ReadonlyArray<{ id: string; display_unit: DisplayUnit }>,
  now: number,
): Promise<Map<string, BestPrice | null>> {
  const result = new Map<string, BestPrice | null>(products.map((p) => [p.id, null]));
  if (products.length === 0) return result;
  const { results } = await db
    .prepare(
      `${POINTS_SQL}
       WHERE v.deleted_at IS NULL AND pp.observed_at >= ?2 AND v.product_id IN (SELECT value FROM json_each(?1))`,
    )
    .bind(JSON.stringify(products.map((p) => p.id)), now - BEST_PRICE_DAYS * DAY_MS)
    .all<PricePoint>();

  const byProduct = groupBy(results, (p) => p.product_id);
  for (const { id, display_unit: unit } of products) {
    const points = byProduct.get(id) ?? [];
    const best = pickBest([...groupBy(points, byVariantStore).values()].map(newest), unit);
    if (best) {
      result.set(id, {
        variant_id: best.variant_id,
        variant_label: best.label,
        display_cents: displayCents(best.cents_per_base, best.measure, unit),
        display_unit: unit,
        store_id: best.store_id,
        source: best.source,
        observed_at: best.observed_at,
      });
    }
  }
  return result;
}

/** Newest point per (store, source) of each variant, without a time window (product detail, 03 §7). */
export async function latestPoints(
  db: D1Database,
  productUnit: DisplayUnit,
  variantIds: string[],
): Promise<Map<string, LatestPoint[]>> {
  const out = new Map<string, LatestPoint[]>(variantIds.map((id) => [id, []]));
  if (variantIds.length === 0) return out;
  const { results } = await db
    .prepare(`${POINTS_SQL} WHERE pp.variant_id IN (SELECT value FROM json_each(?1))`)
    .bind(JSON.stringify(variantIds))
    .all<PricePoint>();
  const latest = [...groupBy(results, (p) => `${p.variant_id}:${p.store_id}:${p.source}`).values()].map(
    newest,
  );
  latest.sort((a, b) => (isNewer(a, b) ? -1 : 1));
  for (const p of latest) {
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

/**
 * Comparator (03 §7): one row per (variant, store) with points in the last `days` days — newest, lowest
 * (ties to the newer) and average price per unit, and how many points. `best` follows pickBest, so with
 * the default 90 days it is the same variant and store as the product list.
 */
export async function comparePrices(
  db: D1Database,
  productId: string,
  unit: DisplayUnit,
  days: number,
  now: number,
): Promise<CompareResponse> {
  const { results } = await db
    .prepare(`${POINTS_SQL} WHERE v.product_id = ?1 AND v.deleted_at IS NULL AND pp.observed_at >= ?2`)
    .bind(productId, now - days * DAY_MS)
    .all<PricePoint>();

  const groups = [...groupBy(results, byVariantStore).values()].map((points) => {
    const last = newest(points);
    const min = points.reduce((a, b) =>
      b.cents_per_base < a.cents_per_base || (b.cents_per_base === a.cents_per_base && isNewer(b, a)) ? b : a,
    );
    const avg = points.reduce((sum, p) => sum + p.cents_per_base, 0) / points.length;
    const rowUnit = unitFor(unit, last.measure);
    const show = (cpb: number) => displayCents(cpb, last.measure, rowUnit);
    const row: CompareRow = {
      variant_id: last.variant_id,
      store_id: last.store_id,
      display_unit: rowUnit,
      last: { display_cents: show(last.cents_per_base), observed_at: last.observed_at, source: last.source },
      min: { display_cents: show(min.cents_per_base), observed_at: min.observed_at },
      avg_display_cents: show(avg),
      n: points.length,
    };
    return { last, row };
  });

  // Comparable rows first, cheapest last price first; then the rest, with deterministic ties.
  groups.sort(
    (a, b) =>
      Number(!fits(unit, a.last.measure)) - Number(!fits(unit, b.last.measure)) ||
      a.last.cents_per_base - b.last.cents_per_base ||
      a.row.variant_id.localeCompare(b.row.variant_id) ||
      a.row.store_id.localeCompare(b.row.store_id),
  );
  const best = pickBest(
    groups.map((g) => g.last),
    unit,
  );
  return {
    display_unit: unit,
    rows: groups.map((g) => g.row),
    best: best ? { variant_id: best.variant_id, store_id: best.store_id } : null,
  };
}
