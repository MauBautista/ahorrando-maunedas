import { z } from 'zod';
import type { PromoType } from '../pricing/promotions';
import type { DisplayUnit, Measure } from '../pricing/units';
import type { ImageRef } from './catalog';

/** `GET /v1/purchases` (03 §7). Ordered by purchased_at and id, newest first. */
export const PurchasesQuerySchema = z.object({
  from: z.coerce.number().int().nonnegative().optional(),
  to: z.coerce.number().int().nonnegative().optional(),
  store_id: z.uuid().optional(),
  status: z.enum(['draft', 'confirmed']).optional(),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export interface PurchaseListItem {
  id: string;
  store_id: string;
  branch_id: string | null;
  purchased_at: number;
  status: 'draft' | 'confirmed';
  source: string;
  total_cents: number | null;
  /** The ticket discounts (Σ of the purchase's promotions): without a ticket total, total = lines − this, ≥ 0. */
  discount_cents: number;
  /** Σ final_cents of the live lines, before the ticket discount (to compare with the ticket total). */
  lines_total_cents: number;
  lines: number;
  receipt_pages: number;
}

export interface PurchasesResponse {
  items: PurchaseListItem[];
  next_cursor: string | null;
}

/** A line of `GET /v1/purchases/:id`: the row plus its variant, whose fields are null while the line is not linked. */
export interface PurchaseLineFields {
  id: string;
  line_no: number;
  variant_id: string | null;
  raw_text: string | null;
  quantity: number;
  unit_price_cents: number;
  gross_cents: number;
  discount_cents: number;
  final_cents: number;
  updated_at: number;
  product_id: string | null;
  product_name: string | null;
  brand: string | null;
  variant_label: string | null;
  measure: Measure | null;
  unit_amount: number | null;
  pack_count: number | null;
  sold_by_weight: boolean | null;
  /** The product's unit, or the default one of the variant's measure (03 §3). */
  display_unit: DisplayUnit | null;
  /** Paid per display unit, with the ticket discount prorated (same as the history). */
  display_cents: number | null;
}

export type PurchaseDetailItem = Record<string, unknown> & PurchaseLineFields;

export type PurchaseRow = Record<string, unknown> & {
  id: string;
  store_id: string;
  branch_id: string | null;
  purchased_at: number;
  status: 'draft' | 'confirmed';
  source: string;
  discount_cents: number;
  total_cents: number | null;
  notes: string | null;
  updated_at: number;
};

export type PromotionRow = Record<string, unknown> & {
  id: string;
  purchase_id: string | null;
  purchase_item_id: string | null;
  type: PromoType;
  /** JSON of `PromoParams`, or null. */
  params: string | null;
  description: string | null;
  discount_cents: number;
  affects_price: number;
  created_at: number;
  updated_at: number;
};

export interface PurchaseDetailResponse {
  purchase: PurchaseRow;
  items: PurchaseDetailItem[];
  promotions: PromotionRow[];
  receipt_images: ImageRef[];
}
