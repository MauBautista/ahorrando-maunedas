import {
  ListingsQuerySchema,
  type ListingsResponse,
  type ListingStateRow,
  type ListingWithState,
  ResolveListingRequestSchema,
  type ResolveListingResponse,
  type UnsupportedUrlReason,
} from '@maunedas/shared/api/listings';
import { canonicalListing, firstUrl, isShortLink } from '@maunedas/shared/tracking/urls';
import { Hono } from 'hono';
import { z } from 'zod';
import { requireUser } from '../auth/middleware';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';
import { parseJsonBody, parseParam, parseQuery } from '../util/validate';

/** Hops of a short link at most; each one only reads `Location`. */
const MAX_HOPS = 5;
const HOP_TIMEOUT_MS = 5_000;
const VERSION = `(SELECT value FROM sync_meta WHERE key = 'version')`;

const unsupported = (reason: UnsupportedUrlReason) => new ApiError(422, 'UNSUPPORTED_URL', { reason });

/**
 * A short link (`amzn.to`, `a.co`) to the page it points to, following redirects by hand: only the `Location`
 * headers are read and no page is downloaded (03 §11).
 */
async function followShortLink(fetchImpl: typeof fetch, start: string): Promise<string> {
  let current = start;
  for (let hop = 0; hop < MAX_HOPS && isShortLink(current); hop++) {
    let res: Response;
    try {
      res = await fetchImpl(current, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(HOP_TIMEOUT_MS),
      });
    } catch {
      throw unsupported('SHORT_LINK');
    }
    await res.body?.cancel();
    const location = res.headers.get('Location');
    if (res.status < 300 || res.status >= 400 || !location) throw unsupported('SHORT_LINK');
    current = new URL(location, current).href;
  }
  if (isShortLink(current)) throw unsupported('SHORT_LINK');
  return current;
}

/** Tracking (03 §11, E2): resolving a shared link, "Revisar ahora" and a variant's listings. */
export const listings = new Hono<AppEnv>()
  .post('/v1/listings/resolve', requireUser(), async (c) => {
    const { url: text } = await parseJsonBody(c, ResolveListingRequestSchema);
    const url = firstUrl(text);
    if (!url) throw unsupported('NO_URL');
    const target = isShortLink(url) ? await followShortLink(c.get('outboundFetch'), url) : url;
    const listing = canonicalListing(target);
    if (!listing) throw unsupported('NOT_TRACKED');
    const store = await c.env.DB.prepare(
      'SELECT id FROM stores WHERE adapter = ?1 AND deleted_at IS NULL ORDER BY created_at, id LIMIT 1',
    )
      .bind(listing.adapter)
      .first<{ id: string }>();
    if (!store) throw unsupported('NO_STORE');
    // The listing itself is created by the client through sync.
    return c.json<ResolveListingResponse>({ ...listing, store_id: store.id, url });
  })

  // "Revisar ahora": the agent sees it in its next `/work` (07 §5.1).
  .post('/v1/listings/:id/check-now', requireUser(), async (c) => {
    const id = parseParam(c.req.param('id'), z.uuid(), 'id');
    const db = c.env.DB;
    const listing = await db
      .prepare('SELECT id FROM listings WHERE id = ?1 AND deleted_at IS NULL')
      .bind(id)
      .first();
    if (!listing) throw new ApiError(404, 'NOT_FOUND');
    const now = Date.now();
    await db.batch([
      db.prepare(`UPDATE sync_meta SET value = value + 1 WHERE key = 'version'`),
      db
        .prepare(
          `INSERT INTO listing_state (listing_id, check_requested_at, updated_at, version) VALUES (?1, ?2, ?2, ${VERSION})
           ON CONFLICT(listing_id) DO UPDATE SET check_requested_at = excluded.check_requested_at,
             updated_at = excluded.updated_at, version = excluded.version`,
        )
        .bind(id, now),
    ]);
    return c.body(null, 202);
  })

  .get('/v1/listings', requireUser(), async (c) => {
    const { variant_id } = parseQuery(c, ListingsQuerySchema);
    const { results } = await c.env.DB.prepare(
      `SELECT l.id, l.variant_id, l.store_id, l.adapter, l.url, l.canonical_url, l.external_id, l.check_interval_min,
              l.active, l.created_at, l.updated_at, l.version, json_object(
                'listing_id', s.listing_id, 'last_checked_at', s.last_checked_at, 'last_status', s.last_status,
                'last_error', s.last_error, 'consecutive_failures', s.consecutive_failures,
                'last_price_cents', s.last_price_cents, 'last_list_price_cents', s.last_list_price_cents,
                'last_in_stock', s.last_in_stock, 'last_promo_text', s.last_promo_text,
                'check_requested_at', s.check_requested_at, 'updated_at', s.updated_at, 'version', s.version
              ) AS state, s.listing_id AS has_state
       FROM listings l LEFT JOIN listing_state s ON s.listing_id = l.id
       WHERE l.variant_id = ?1 AND l.deleted_at IS NULL ORDER BY l.created_at, l.id`,
    )
      .bind(variant_id)
      .all<Omit<ListingWithState, 'state'> & { state: string; has_state: string | null }>();
    return c.json<ListingsResponse>({
      items: results.map(({ state, has_state, ...l }) => ({
        ...l,
        state: has_state ? (JSON.parse(state) as ListingStateRow) : null,
      })),
    });
  });
