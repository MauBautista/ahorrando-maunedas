import { z } from 'zod';

export type AlertType = 'below_price' | 'drop_pct' | 'new_low' | 'back_in_stock' | 'promo';
export type DeliveryStatus = 'sent' | 'partial' | 'failed' | 'no_devices';

/** A row of `alert_events` (down, per user). */
export interface AlertEventRow {
  id: string;
  rule_id: string;
  user_id: string;
  observation_id: string | null;
  fired_at: number;
  title: string;
  body: string;
  delivery_status: DeliveryStatus;
  version: number;
}

/** `GET /v1/alerts/events` (03 §11): mine, newest first. */
export const AlertEventsQuerySchema = z.object({
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export interface AlertEventsResponse {
  items: AlertEventRow[];
  next_cursor: string | null;
}
