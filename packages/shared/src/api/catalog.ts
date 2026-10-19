import { z } from 'zod';
import type { DisplayUnit } from '../pricing/units';

/** Common response types (03 §3). */
export type PriceSource = 'purchase' | 'shelf' | 'web';

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

export interface VariantSearchItem {
  variant_id: string;
  product_id: string;
  product_name: string;
  brand: string | null;
  variant_label: string;
  barcode_match: boolean;
  image: ImageRef | null;
}
