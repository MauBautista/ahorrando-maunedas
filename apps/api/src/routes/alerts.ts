import {
  AlertEventsQuerySchema,
  type AlertEventItem,
  type AlertEventsResponse,
  type AlertRuleItem,
  AlertRulesQuerySchema,
  type AlertRulesResponse,
} from '@maunedas/shared/api/alerts';
import { Hono } from 'hono';
import { requireUser } from '../auth/middleware';
import type { AppEnv } from '../env';
import { decodeCursor, encodeCursor } from '../util/cursor';
import { parseQuery } from '../util/validate';

/** What a rule or an alert watches, for the web (T-223). */
const SUBJECT = `v.product_id, p.name AS product_name, p.brand, v.label AS variant_label`;

/**
 * `GET /v1/alerts/events` (03 §11): the user's own alerts, newest first, with what they are about so the web can
 * link them (Android pulls them).
 */
export const alerts = new Hono<AppEnv>()
  .get('/v1/alerts/events', requireUser(), async (c) => {
    const query = parseQuery(c, AlertEventsQuerySchema);
    const user = c.get('user');
    const [at, id] = query.cursor ? decodeCursor(query.cursor, 2) : [Number.MAX_SAFE_INTEGER, ''];
    const { results } = await c.env.DB.prepare(
      `SELECT e.*, r.variant_id, ${SUBJECT}
     FROM alert_events e
     LEFT JOIN alert_rules r ON r.id = e.rule_id
     LEFT JOIN variants v ON v.id = r.variant_id
     LEFT JOIN products p ON p.id = v.product_id
     WHERE e.user_id = ?1 AND (e.fired_at, e.id) < (?2, ?3)
     ORDER BY e.fired_at DESC, e.id DESC LIMIT ?4`,
    )
      // Without a cursor every event is before the largest time.
      .bind(user.id, Number(at), String(id), query.limit + 1)
      .all<AlertEventItem>();
    const items = results.slice(0, query.limit);
    const last = items.at(-1);
    return c.json<AlertEventsResponse>({
      items,
      next_cursor: results.length > query.limit && last ? encodeCursor([last.fired_at, last.id]) : null,
    });
  })

  // T-223: the web keeps no copy of the user's rules (Android has them through sync).
  .get('/v1/alerts/rules', requireUser(), async (c) => {
    const { variant_id } = parseQuery(c, AlertRulesQuerySchema);
    const { results } = await c.env.DB.prepare(
      `SELECT r.id, r.user_id, r.variant_id, r.listing_id, r.type, r.threshold_cents, r.threshold_pct, r.scope,
              r.cooldown_hours, r.active, r.created_at, r.updated_at, r.deleted_at, r.version, ${SUBJECT},
              s.name AS store_name
       FROM alert_rules r
       JOIN variants v ON v.id = r.variant_id
       JOIN products p ON p.id = v.product_id
       LEFT JOIN listings l ON l.id = r.listing_id
       LEFT JOIN stores s ON s.id = l.store_id
       WHERE r.user_id = ?1 AND r.deleted_at IS NULL AND (?2 IS NULL OR r.variant_id = ?2)
       ORDER BY p.name COLLATE NOCASE, v.label COLLATE NOCASE, r.created_at, r.id`,
    )
      .bind(c.get('user').id, variant_id ?? null)
      .all<AlertRuleItem>();
    return c.json<AlertRulesResponse>({ items: results });
  });
