import { z } from 'zod';
import type { PriceSource } from './catalog';
import type { DisplayUnit } from '../pricing/units';

/** One price of a variant for Home Assistant (03 §13): per piece or pack, and per display unit. */
export interface HaPrice {
  /** Effective price of the piece or pack, after promotions. */
  price_cents: number;
  /** Per `display_unit` (L, kg, 100 g…), as the catalog compares. */
  display_cents: number;
  store: string;
  source: PriceSource;
  observed_at: number;
}

/** `GET /ha/v1/variants/:id`. */
export interface HaVariant {
  variant_id: string;
  name: string;
  display_unit: DisplayUnit;
  /** The cheapest of each store's latest price of the last 90 days; null without prices. */
  current: HaPrice | null;
  /** The lowest price per unit ever seen. */
  lowest: HaPrice | null;
  /** Whether a followed link has it in stock; null when no link has been checked. */
  in_stock: boolean | null;
  listings: Array<{
    store: string;
    price_cents: number | null;
    in_stock: boolean | null;
    status: string | null;
    checked_at: number | null;
  }>;
}

/** `GET /ha/v1/variants`: every live variant, to find its id. */
export interface HaVariantsResponse {
  items: Array<{ variant_id: string; name: string }>;
}

/** `POST /v1/admin/ha-tokens`. */
export const HaTokenCreateSchema = z.object({ name: z.string().trim().min(1).max(60) });

export interface HaTokenItem {
  id: string;
  name: string;
  created_by_name: string;
  created_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
}

/** The token is shown once, when it is created. */
export interface HaTokenCreated extends HaTokenItem {
  token: string;
}

export interface HaTokensResponse {
  items: HaTokenItem[];
}
