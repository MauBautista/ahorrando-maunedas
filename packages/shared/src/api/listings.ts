import { z } from 'zod';
import type { Adapter } from '../tracking/adapters';

/** `POST /v1/listings/resolve` (03 §11): a link, or a shared text that contains one. */
export const ResolveListingRequestSchema = z.object({ url: z.string().min(1).max(2000) });

export interface ResolveListingResponse {
  adapter: Adapter;
  store_id: string;
  /** The link as the user shared it (what `listings.url` keeps). */
  url: string;
  canonical_url: string;
  external_id: string | null;
}

/** Why a link cannot be tracked (`422 E-UNSUPPORTED_URL`, `details.reason`). */
export type UnsupportedUrlReason = 'NO_URL' | 'SHORT_LINK' | 'NOT_TRACKED' | 'NO_STORE';

/** `GET /v1/listings?variant_id=` (03 §11); without `variant_id`, every live listing (W-20, T-223). */
export const ListingsQuerySchema = z.object({ variant_id: z.uuid().optional() });

export interface ListingStateRow {
  listing_id: string;
  last_checked_at: number | null;
  last_status: 'pending' | 'ok' | 'not_found' | 'blocked' | 'error' | null;
  last_error: string | null;
  consecutive_failures: number;
  last_price_cents: number | null;
  last_list_price_cents: number | null;
  last_in_stock: number | null;
  last_promo_text: string | null;
  check_requested_at: number | null;
  updated_at: number;
  version: number;
}

export interface ListingWithState {
  id: string;
  variant_id: string;
  store_id: string;
  adapter: Adapter;
  url: string;
  canonical_url: string | null;
  external_id: string | null;
  check_interval_min: number | null;
  active: number;
  created_at: number;
  updated_at: number;
  version: number;
  /** What the listing tracks and where, to show it without more requests. */
  product_id: string;
  product_name: string;
  brand: string | null;
  variant_label: string;
  store_name: string;
  /** The store's `default_check_interval_min`, which a listing without its own interval follows (T-224). */
  store_interval_min: number;
  state: ListingStateRow | null;
}

export interface ListingsResponse {
  items: ListingWithState[];
}
