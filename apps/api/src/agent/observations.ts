import type { AgentResult } from '@maunedas/shared/api/agent';
import { uuidv7 } from '@maunedas/shared/util/uuid';
import { log } from '../util/log';

const VERSION = `(SELECT value FROM sync_meta WHERE key = 'version')`;
/** A check reported this far in the future is taken as now (a wrong clock on the home server). */
const CLOCK_SKEW_MS = 5 * 60_000;
const MAX_EXTRA_CHARS = 4000;

interface ListingWithState {
  id: string;
  variant_id: string;
  store_id: string;
  deleted_at: number | null;
  last_checked_at: number | null;
  last_status: string | null;
  consecutive_failures: number | null;
  last_price_cents: number | null;
  last_list_price_cents: number | null;
  last_in_stock: number | null;
  last_promo_text: string | null;
  has_state: number;
}

/** What a listing was before this request, for the alerts of T-212 (08 §2). */
export type PreviousState = Pick<
  ListingWithState,
  'last_status' | 'last_price_cents' | 'last_list_price_cents' | 'last_in_stock' | 'last_promo_text'
> | null;

export interface CreatedObservation {
  id: string;
  listing_id: string;
  variant_id: string;
  store_id: string;
  price_cents: number;
  list_price_cents: number | null;
  in_stock: number | null;
  promo_text: string | null;
  observed_at: number;
  prev: PreviousState;
}

export interface IngestResult {
  accepted: number;
  created: CreatedObservation[];
  /** Listings that went to `blocked` with this request (08 §5: the admin is told). */
  newlyBlocked: string[];
}

const toInt = (b: boolean | null | undefined) => (b === null || b === undefined ? null : b ? 1 : 0);
const FAILURES = new Set(['error', 'blocked']);

/**
 * The agent's checks into `listing_state` and web `price_observations` (07 §6), in one batch with one new version:
 * - **Retries** (`checked_at` not after the last one) are ignored, so the outbox can resend safely.
 * - **Compression by change:** a web observation only when an `ok` check differs in price, list price, stock or
 *   promotion, or follows a check that was not `ok`. Without a price (out of stock) the state changes but no
 *   observation is made, since `price_cents` is required.
 * - **Failures:** `error` and `blocked` add one to `consecutive_failures` and keep the last known prices; `ok` and
 *   `not_found` (the page answered) reset it. A listing that becomes `blocked` is reported once.
 * Results of one listing are taken in `checked_at` order, so a batch with several checks of it compresses too.
 */
export async function ingest(db: D1Database, results: AgentResult[], now: number): Promise<IngestResult> {
  const ids = [...new Set(results.map((r) => r.listing_id))];
  const { results: rows } = await db
    .prepare(
      `SELECT l.id, l.variant_id, l.store_id, l.deleted_at, s.last_checked_at, s.last_status, s.consecutive_failures,
              s.last_price_cents, s.last_list_price_cents, s.last_in_stock, s.last_promo_text,
              (s.listing_id IS NOT NULL) AS has_state
       FROM listings l LEFT JOIN listing_state s ON s.listing_id = l.id
       WHERE l.id IN (SELECT value FROM json_each(?1))`,
    )
    .bind(JSON.stringify(ids))
    .all<ListingWithState>();
  const listings = new Map(rows.map((r) => [r.id, r]));
  const stmts: D1PreparedStatement[] = [];
  const created: CreatedObservation[] = [];
  const newlyBlocked: string[] = [];

  for (const r of [...results].sort((a, b) => a.checked_at - b.checked_at)) {
    const l = listings.get(r.listing_id);
    if (!l || l.deleted_at !== null) continue;
    const checkedAt = Math.min(r.checked_at, now + CLOCK_SKEW_MS);
    if (l.last_checked_at !== null && checkedAt <= l.last_checked_at) continue;

    const prev: PreviousState = l.has_state
      ? {
          last_status: l.last_status,
          last_price_cents: l.last_price_cents,
          last_list_price_cents: l.last_list_price_cents,
          last_in_stock: l.last_in_stock,
          last_promo_text: l.last_promo_text,
        }
      : null;
    const ok = r.status === 'ok';
    const seen = {
      price: r.price_cents,
      list: r.list_price_cents ?? null,
      stock: toInt(r.in_stock),
      promo: r.promo_text ?? null,
    };
    const changed =
      ok &&
      (prev?.last_status !== 'ok' ||
        prev.last_price_cents !== seen.price ||
        prev.last_list_price_cents !== seen.list ||
        prev.last_in_stock !== seen.stock ||
        (prev.last_promo_text ?? null) !== seen.promo);
    const failures = FAILURES.has(r.status) ? (l.consecutive_failures ?? 0) + 1 : 0;
    // A failed check keeps what was last known of the price.
    const next = ok
      ? { price: seen.price, list: seen.list, stock: seen.stock, promo: seen.promo }
      : {
          price: l.last_price_cents,
          list: l.last_list_price_cents,
          stock: l.last_in_stock,
          promo: l.last_promo_text,
        };

    stmts.push(
      db
        .prepare(
          `INSERT INTO listing_state (listing_id, last_checked_at, last_status, last_error, consecutive_failures,
             last_price_cents, last_list_price_cents, last_in_stock, last_promo_text, updated_at, version)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ${VERSION})
           ON CONFLICT(listing_id) DO UPDATE SET last_checked_at = excluded.last_checked_at,
             last_status = excluded.last_status, last_error = excluded.last_error,
             consecutive_failures = excluded.consecutive_failures, last_price_cents = excluded.last_price_cents,
             last_list_price_cents = excluded.last_list_price_cents, last_in_stock = excluded.last_in_stock,
             last_promo_text = excluded.last_promo_text, updated_at = excluded.updated_at, version = excluded.version`,
        )
        .bind(
          l.id,
          checkedAt,
          r.status,
          ok ? null : (r.error ?? null),
          failures,
          next.price,
          next.list,
          next.stock,
          next.promo,
          now,
        ),
    );
    if (changed && seen.price !== null) {
      const id = uuidv7(now);
      const extra = r.extra ? JSON.stringify(r.extra).slice(0, MAX_EXTRA_CHARS) : null;
      stmts.push(
        db
          .prepare(
            `INSERT INTO price_observations (id, variant_id, store_id, listing_id, source, price_cents, list_price_cents,
               in_stock, promo_text, extra, observed_at, created_at, updated_at, updated_by, version)
             VALUES (?1, ?2, ?3, ?4, 'web', ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11, 'agent', ${VERSION})`,
          )
          .bind(
            id,
            l.variant_id,
            l.store_id,
            l.id,
            seen.price,
            seen.list,
            seen.stock,
            seen.promo,
            extra,
            checkedAt,
            now,
          ),
      );
      created.push({
        id,
        listing_id: l.id,
        variant_id: l.variant_id,
        store_id: l.store_id,
        price_cents: seen.price,
        list_price_cents: seen.list,
        in_stock: seen.stock,
        promo_text: seen.promo,
        observed_at: checkedAt,
        prev,
      });
    }
    if (r.status === 'blocked' && l.last_status !== 'blocked') newlyBlocked.push(l.id);
    // A later check of the same listing in this request compares against this one.
    Object.assign(l, {
      last_checked_at: checkedAt,
      last_status: r.status,
      consecutive_failures: failures,
      last_price_cents: next.price,
      last_list_price_cents: next.list,
      last_in_stock: next.stock,
      last_promo_text: next.promo,
      has_state: 1,
    });
  }

  if (stmts.length > 0) {
    await db.batch([db.prepare(`UPDATE sync_meta SET value = value + 1 WHERE key = 'version'`), ...stmts]);
  }
  return { accepted: results.length, created, newlyBlocked };
}

/**
 * After the answer (`ctx.waitUntil`, CLAUDE.md rule 13): the alerts of the new observations (T-212, 08) and the
 * admin's notice of a newly blocked store (T-213, 08 §5). Until those land, it only leaves the trace.
 */
export async function afterIngest(result: IngestResult): Promise<void> {
  for (const id of result.newlyBlocked) log('warn', 'listing_blocked', { listing_id: id });
}
