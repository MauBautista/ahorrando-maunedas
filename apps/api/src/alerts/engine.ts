import type { AlertType, DeliveryStatus } from '@maunedas/shared/api/alerts';
import { centsPerBase, displayCents, type DisplayUnit, type Measure } from '@maunedas/shared/pricing/units';
import { uuidv7 } from '@maunedas/shared/util/uuid';
import type { CreatedObservation } from '../agent/observations';
import { unitFor } from '../db/queries/prices';
import { log } from '../util/log';
import { type AlertRuleRow, type ObsView, PRIORITY, shouldFire } from './evaluate';
import { alertMessage, type MessageFacts } from './messages';

const VERSION = `(SELECT value FROM sync_meta WHERE key = 'version')`;
const HOUR_MS = 3_600_000;

/** What a delivery needs (08 §6): the database for the devices; T-213 adds Firebase. */
export interface AlertEnv {
  DB: D1Database;
}

/** Sends one notification to a user's devices and says how it went (08 §6). */
export type Deliver = (
  env: AlertEnv,
  userId: string,
  data: Record<string, string>,
) => Promise<DeliveryStatus>;

/**
 * Until FCM delivery lands (T-213): a user without a device token is `no_devices`; one with tokens is `failed`,
 * with a trace, since nothing was sent. The events stay in the user's history either way.
 */
export const deliverPending: Deliver = async (env, userId) => {
  const tokens = await env.DB.prepare(
    'SELECT count(*) AS n FROM devices WHERE user_id = ?1 AND fcm_token IS NOT NULL',
  )
    .bind(userId)
    .first<number>('n');
  if (!tokens) return 'no_devices';
  log('warn', 'alert_not_delivered', { user_id: userId, reason: 'fcm_pending' });
  return 'failed';
};

interface VariantFacts {
  id: string;
  label: string;
  measure: Measure;
  unit_amount: number;
  pack_count: number;
  product_name: string;
  display_unit: DisplayUnit;
}

const toBool = (v: number | null) => (v === null ? null : v === 1);
const json = (ids: Iterable<string>) => JSON.stringify([...new Set(ids)]);

/**
 * The alerts of new web observations (08 §1–4), after the agent's answer:
 * - each observation is checked against the active rules of its variant (and of its listing, or any listing);
 * - a rule that fired within its `cooldown_hours` is silent, also for a second observation of this same run;
 * - the rules one observation fires for one user are one notification of the highest priority type, and one
 *   `alert_event` per rule, all with the delivery's status, in one batch with a new version.
 * D1 is asked a fixed number of times whatever the number of observations (Free plan subrequests, rule 13).
 */
export async function evaluateAlerts(
  env: AlertEnv,
  created: CreatedObservation[],
  now: number,
  deliver: Deliver = deliverPending,
): Promise<number> {
  if (created.length === 0) return 0;
  const db = env.DB;
  const variantIds = json(created.map((o) => o.variant_id));
  const [rulesRes, variantsRes, storesRes, firedRes] = await db.batch<Record<string, unknown>>([
    db
      .prepare(
        `SELECT id, user_id, variant_id, listing_id, type, threshold_cents, threshold_pct, scope, cooldown_hours
         FROM alert_rules
         WHERE active = 1 AND deleted_at IS NULL AND variant_id IN (SELECT value FROM json_each(?1))`,
      )
      .bind(variantIds),
    db
      .prepare(
        `SELECT v.id, v.label, v.measure, v.unit_amount, v.pack_count, p.name AS product_name, p.display_unit
         FROM variants v JOIN products p ON p.id = v.product_id
         WHERE v.id IN (SELECT value FROM json_each(?1))`,
      )
      .bind(variantIds),
    db
      .prepare('SELECT id, name FROM stores WHERE id IN (SELECT value FROM json_each(?1))')
      .bind(json(created.map((o) => o.store_id))),
    db
      .prepare(
        `SELECT e.rule_id, MAX(e.fired_at) AS last FROM alert_events e JOIN alert_rules r ON r.id = e.rule_id
         WHERE r.variant_id IN (SELECT value FROM json_each(?1)) GROUP BY e.rule_id`,
      )
      .bind(variantIds),
  ]);
  const rules = rulesRes!.results as unknown as AlertRuleRow[];
  if (rules.length === 0) return 0;
  const variants = new Map((variantsRes!.results as unknown as VariantFacts[]).map((v) => [v.id, v]));
  const stores = new Map(
    (storesRes!.results as Array<{ id: string; name: string }>).map((s) => [s.id, s.name]),
  );
  const lastFired = new Map(
    (firedRes!.results as Array<{ rule_id: string; last: number }>).map((r) => [r.rule_id, r.last]),
  );

  const candidates = created.map((obs) => ({
    obs,
    rules: rules.filter(
      (r) => r.variant_id === obs.variant_id && (r.listing_id === null || r.listing_id === obs.listing_id),
    ),
  }));

  // new_low: the lowest price per base unit of each scope it needs, without the observation itself (08 §3) and
  // without what was seen after it: a later check of the same request is not its history.
  const minQueries: Array<{ key: string; stmt: D1PreparedStatement }> = [];
  for (const { obs, rules: own } of candidates) {
    for (const scope of new Set(own.filter((r) => r.type === 'new_low').map((r) => r.scope))) {
      const where =
        scope === 'listing'
          ? `listing_id = ?1 AND source = 'web'`
          : scope === 'variant_web'
            ? `variant_id = ?1 AND source = 'web'`
            : 'variant_id = ?1';
      const subject = scope === 'listing' ? obs.listing_id : obs.variant_id;
      minQueries.push({
        key: `${obs.id}:${scope}`,
        stmt: db
          .prepare(
            `SELECT MIN(cents_per_base) AS m FROM v_price_points
             WHERE ${where} AND point_id != ?2 AND observed_at <= ?3`,
          )
          .bind(subject, obs.id, obs.observed_at),
      });
    }
  }
  const mins = new Map<string, number | null>();
  if (minQueries.length > 0) {
    const res = await db.batch<{ m: number | null }>(minQueries.map((q) => q.stmt));
    minQueries.forEach((q, i) => mins.set(q.key, res[i]!.results[0]?.m ?? null));
  }

  const events: D1PreparedStatement[] = [];
  for (const { obs, rules: own } of candidates) {
    const variant = variants.get(obs.variant_id);
    if (!variant || own.length === 0) continue;
    const cpb = centsPerBase(obs.price_cents, 1, variant.unit_amount, variant.pack_count);
    const view = {
      priceCents: obs.price_cents,
      centsPerBase: cpb,
      listPriceCents: obs.list_price_cents,
      inStock: toBool(obs.in_stock),
      promoText: obs.promo_text,
    };
    const prev: ObsView | null = obs.prev && {
      priceCents: obs.prev.last_price_cents,
      listPriceCents: obs.prev.last_list_price_cents,
      inStock: toBool(obs.prev.last_in_stock),
      promoText: obs.prev.last_promo_text,
    };
    const fired = own.filter((r) => {
      const last = lastFired.get(r.id);
      if (last !== undefined && last > now - r.cooldown_hours * HOUR_MS) return false;
      return shouldFire(r, view, prev, mins.get(`${obs.id}:${r.scope}`) ?? null);
    });
    const unit = unitFor(variant.display_unit, variant.measure);
    const facts = (r: AlertRuleRow): MessageFacts => ({
      product: `${variant.product_name} · ${variant.label}`,
      store: stores.get(obs.store_id) ?? 'la tienda',
      priceCents: obs.price_cents,
      listPriceCents: obs.list_price_cents,
      promoText: obs.promo_text,
      perUnitCents: displayCents(cpb, variant.measure, unit),
      unit,
      prevPriceCents: prev?.priceCents ?? null,
      thresholdCents: r.threshold_cents,
      promoIsText: !!obs.promo_text && obs.promo_text !== (prev?.promoText ?? null),
    });

    const byUser = new Map<string, AlertRuleRow[]>();
    for (const r of fired) byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r]);
    for (const [userId, userRules] of byUser) {
      const ordered = [...userRules].sort((a, b) => PRIORITY.indexOf(a.type) - PRIORITY.indexOf(b.type));
      const rows = ordered.map((r) => ({
        id: uuidv7(now),
        rule: r,
        ...alertMessage(r.type as AlertType, facts(r)),
      }));
      const top = rows[0]!;
      const status = await deliver(env, userId, {
        type: 'price_alert',
        title: top.title,
        body: top.body,
        variant_id: obs.variant_id,
        listing_id: obs.listing_id,
        event_id: top.id,
        channel: 'price_alerts',
      });
      for (const row of rows) {
        lastFired.set(row.rule.id, now);
        events.push(
          db
            .prepare(
              `INSERT INTO alert_events (id, rule_id, user_id, observation_id, fired_at, title, body, delivery_status, version)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ${VERSION})`,
            )
            .bind(row.id, row.rule.id, userId, obs.id, now, row.title, row.body, status),
        );
      }
    }
  }
  if (events.length > 0) {
    await db.batch([db.prepare(`UPDATE sync_meta SET value = value + 1 WHERE key = 'version'`), ...events]);
  }
  return events.length;
}
