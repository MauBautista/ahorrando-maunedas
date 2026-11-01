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

/** What an alert is about, to show and link it (T-223); null if its rule or variant is gone. */
export interface AlertSubject {
  variant_id: string | null;
  product_id: string | null;
  product_name: string | null;
  brand: string | null;
  variant_label: string | null;
}

export type AlertEventItem = AlertEventRow & AlertSubject;

export type AlertScope = 'listing' | 'variant_web' | 'variant_all';

/** A row of `alert_rules` (sync, per user). */
export interface AlertRuleRow {
  id: string;
  user_id: string;
  variant_id: string;
  listing_id: string | null;
  type: AlertType;
  threshold_cents: number | null;
  threshold_pct: number | null;
  scope: AlertScope;
  cooldown_hours: number;
  active: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  version: number;
}

/** `GET /v1/alerts/rules?variant_id=` (T-223): my live rules, with what they watch. */
export const AlertRulesQuerySchema = z.object({ variant_id: z.uuid().optional() });

export interface AlertRuleItem extends AlertRuleRow {
  product_id: string;
  product_name: string;
  brand: string | null;
  variant_label: string;
  /** The store of `listing_id`, when the rule watches one listing only. */
  store_name: string | null;
}

export interface AlertRulesResponse {
  items: AlertRuleItem[];
}

/** `GET /v1/alerts/events` (03 §11): mine, newest first. */
export const AlertEventsQuerySchema = z.object({
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export interface AlertEventsResponse {
  items: AlertEventItem[];
  next_cursor: string | null;
}
