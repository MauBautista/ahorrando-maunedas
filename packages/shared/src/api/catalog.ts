import { z } from 'zod';
import type { DisplayUnit, Measure } from '../pricing/units';

/** Common response types (03 §3). */
export const PRICE_SOURCES = ['purchase', 'shelf', 'web'] as const;
export type PriceSource = (typeof PRICE_SOURCES)[number];

export interface ImageRef {
  image_id: string;
  /** Signed URLs valid ~24 h (10 §3); null while the binary or rendition does not exist. */
  thumb_url: string | null;
  processed_url: string | null;
  original_url: string | null;
  license: string | null;
  attribution: string | null;
}

export interface BestPrice {
  variant_id: string;
  variant_label: string;
  /** Per the product's display unit. */
  display_cents: number;
  display_unit: DisplayUnit;
  store_id: string;
  source: PriceSource;
  observed_at: number;
}

const optionalId = z.uuid().optional();

/** `GET /v1/products` (03 §7). */
export const ProductsQuerySchema = z.object({
  q: z.string().max(200).optional(),
  category_id: optionalId,
  tag_id: optionalId,
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

/** `GET /v1/search/variants` (03 §7). */
export const SearchVariantsQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  /** The purchase's store: each result brings its latest list price there (S-05). */
  store_id: z.uuid().optional(),
});

export interface ProductListItem {
  id: string;
  name: string;
  brand: string | null;
  category_id: string | null;
  display_unit: DisplayUnit;
  image: ImageRef | null;
  variants: number;
  best: BestPrice | null;
}

export interface ProductsResponse {
  items: ProductListItem[];
  next_cursor: string | null;
}

export interface LatestPoint {
  store_id: string;
  source: PriceSource;
  effective_unit_cents: number;
  display_cents: number;
  /** The product's unit, or the default unit of the variant's measure when they differ (03 §3). */
  display_unit: DisplayUnit;
  observed_at: number;
}

/** What a purchase line needs of its variant to compute and show (05 §5 S-04, S-05). */
export interface LineVariantInfo {
  measure: Measure;
  unit_amount: number;
  pack_count: number;
  sold_by_weight: boolean;
  /** The product's unit, or the default unit of the variant's measure when they differ (03 §3). */
  display_unit: DisplayUnit;
}

export interface VariantSearchItem extends LineVariantInfo {
  variant_id: string;
  product_id: string;
  product_name: string;
  brand: string | null;
  variant_label: string;
  barcode_match: boolean;
  image: ImageRef | null;
  /** List price of the newest price point at `store_id` (any source); null without `store_id` or price there. */
  last_unit_cents: number | null;
}

/** `GET /v1/products/:id/compare` (03 §7). */
export const CompareQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(3650).default(90),
});

export interface CompareRow {
  variant_id: string;
  store_id: string;
  /** The product's unit, or the default unit of the variant's measure when they differ (03 §3). */
  display_unit: DisplayUnit;
  last: { display_cents: number; observed_at: number; source: PriceSource };
  min: { display_cents: number; observed_at: number };
  avg_display_cents: number;
  n: number;
}

export interface CompareResponse {
  display_unit: DisplayUnit;
  rows: CompareRow[];
  best: { variant_id: string; store_id: string } | null;
}

/** `GET /v1/variants/:id/history` (03 §7). `from`/`to` default to the last 365 days. */
export const HistoryQuerySchema = z.object({
  from: z.coerce.number().int().nonnegative().optional(),
  to: z.coerce.number().int().nonnegative().optional(),
  sources: z
    .string()
    .optional()
    .transform((s) =>
      s === undefined ? [...PRICE_SOURCES] : [...new Set(s.split(',').map((x) => x.trim()))],
    )
    .pipe(z.array(z.enum(PRICE_SOURCES)).min(1)),
  store_id: optionalId,
});

export const HISTORY_DEFAULT_DAYS = 365;

export interface HistoryPoint {
  source: PriceSource;
  point_id: string;
  store_id: string;
  branch_id: string | null;
  listing_id: string | null;
  observed_at: number;
  list_unit_cents: number;
  effective_unit_cents: number;
  display_cents: number;
  has_promo: boolean;
}

export interface HistoryResponse {
  variant: Record<string, unknown> & { id: string; product_name: string };
  display_unit: DisplayUnit;
  points: HistoryPoint[];
  /** listing_id → listing_state.last_checked_at: until when the last web price was confirmed. */
  web_confirmed_until: Record<string, number>;
}

/** `GET /v1/lookups` (03 §7): the live rows, with the fields the web reads. */
export interface LookupsResponse {
  stores: Array<{ id: string; name: string; kind: 'physical' | 'online' | 'both' }>;
  store_branches: Array<{ id: string; store_id: string; name: string; city: string | null }>;
  categories: Array<{ id: string; parent_id: string | null; name: string; sort_order: number }>;
  tags: Array<{ id: string; name: string }>;
}

/** A variant of `GET /v1/products/:id`: its row, codes, photo and latest point per store and source. */
export interface ProductDetailVariant {
  id: string;
  product_id: string;
  label: string;
  measure: Measure;
  unit_amount: number;
  pack_count: number;
  sold_by_weight: 0 | 1;
  primary_image_id: string | null;
  updated_at: number;
  barcodes: string[];
  /** The rows behind [barcodes], for editing by push. */
  barcode_rows: Array<{ id: string; code: string; updated_at: number }>;
  image: ImageRef | null;
  latest: LatestPoint[];
}

/** `GET /v1/products/:id` (03 §7). */
export interface ProductDetailResponse {
  product: {
    id: string;
    name: string;
    brand: string | null;
    category_id: string | null;
    display_unit: DisplayUnit;
    notes: string | null;
    primary_image_id: string | null;
    updated_at: number;
    tags: Array<{ id: string; name: string }>;
    image: ImageRef | null;
  };
  variants: ProductDetailVariant[];
}
