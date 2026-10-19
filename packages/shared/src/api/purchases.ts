import { z } from 'zod';
import type { DisplayUnit } from '../pricing/units';
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
  /** Σ final_cents of the live lines, before the ticket discount (to compare with the ticket total). */
  lines_total_cents: number;
  lines: number;
  receipt_pages: number;
}

export interface PurchasesResponse {
  items: PurchaseListItem[];
  next_cursor: string | null;
}

/** A line of `GET /v1/purchases/:id`: the row plus its product, null while the line is not linked. */
export type PurchaseDetailItem = Record<string, unknown> & {
  id: string;
  product_id: string | null;
  product_name: string | null;
  variant_label: string | null;
  display_unit: DisplayUnit | null;
  /** Paid per display unit, with the ticket discount prorated (same as the history). */
  display_cents: number | null;
};

export interface PurchaseDetailResponse {
  purchase: Record<string, unknown> & { id: string };
  items: PurchaseDetailItem[];
  promotions: Array<Record<string, unknown>>;
  receipt_images: ImageRef[];
}
