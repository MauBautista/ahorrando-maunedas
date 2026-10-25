import type { AiBudget } from '@maunedas/shared/api/admin';
import { uuidv7 } from '@maunedas/shared/util/uuid';
import { ApiError } from '../errors';
import { log } from '../util/log';
import type { AiPurpose, AiUsage } from './types';

/** Central Mexico has no daylight saving time since 2022: the month is UTC−6 fixed (09 §2). */
const MX_OFFSET_MS = 6 * 3_600_000;
const DAY_MS = 86_400_000;

export interface BudgetEnv {
  DB: D1Database;
  AI_MONTHLY_BUDGET_USD: string;
  AI_SOFT_LIMIT_PCT: string;
}

/** The calendar month in Mexico City that holds [nowMs]: `key` like "2026-10" and its bounds in UTC ms. */
export function monthWindow(nowMs: number) {
  const local = new Date(nowMs - MX_OFFSET_MS);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  return {
    key: `${y}-${String(m + 1).padStart(2, '0')}`,
    start: Date.UTC(y, m, 1) + MX_OFFSET_MS,
    end: Date.UTC(y, m + 1, 1) + MX_OFFSET_MS,
  };
}

const toMicros = (usd: number) => Math.round(usd * 1e6);

async function spentMicros(db: D1Database, nowMs: number): Promise<number> {
  const { start, end } = monthWindow(nowMs);
  const r = await db
    .prepare(
      `SELECT COALESCE(SUM(cost_usd_micros), 0) AS s FROM ai_usage WHERE created_at >= ?1 AND created_at < ?2`,
    )
    .bind(start, end)
    .first<{ s: number }>();
  return r?.s ?? 0;
}

export async function spentThisMonthUsd(db: D1Database, nowMs = Date.now()): Promise<number> {
  return (await spentMicros(db, nowMs)) / 1e6;
}

/**
 * Before a call: `spent + estimate > budget` → `402 E-AI_BUDGET_EXCEEDED` (09 §2). Compared in whole micro-dollars,
 * so landing exactly on the budget is not decided by float rounding.
 */
export async function assertBudget(env: BudgetEnv, estimateUsd: number, nowMs = Date.now()): Promise<void> {
  const spent = await spentMicros(env.DB, nowMs);
  const budget = Number(env.AI_MONTHLY_BUDGET_USD);
  if (spent + toMicros(estimateUsd) > toMicros(budget)) {
    throw new ApiError(402, 'AI_BUDGET_EXCEEDED', { spent_usd: spent / 1e6, budget_usd: budget });
  }
}

/**
 * After a call that reached the model (an answer, good or unusable): one `ai_usage` row with the reported cost,
 * or [estimateUsd] when the provider did not say. Then the soft limit is checked.
 */
export async function recordUsage(
  env: BudgetEnv,
  purpose: AiPurpose,
  userId: string | null,
  usage: AiUsage,
  estimateUsd: number,
  nowMs = Date.now(),
): Promise<number> {
  const cost = usage.cost_usd ?? estimateUsd;
  await env.DB.prepare(
    `INSERT INTO ai_usage (id, purpose, provider, model, user_id, input_tokens, output_tokens, cost_usd_micros, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
  )
    .bind(
      uuidv7(nowMs),
      purpose,
      usage.provider,
      usage.model,
      userId,
      usage.input_tokens,
      usage.output_tokens,
      toMicros(cost),
      nowMs,
    )
    .run();
  await checkSoftLimit(env, nowMs);
  return cost;
}

/** The share of the budget that turns on the warning (`AI_SOFT_LIMIT_PCT`, 80 %). */
function softLimitUsd(env: BudgetEnv): number {
  return (Number(env.AI_MONTHLY_BUDGET_USD) * Number(env.AI_SOFT_LIMIT_PCT)) / 100;
}

/**
 * Crossing the soft limit warns the admin once a month: the mark `ai_soft:<YYYY-MM>` in `token_cache` is written
 * only the first time, and lasts until the month is over (the daily cleanup drops it afterwards). In E1 the warning
 * is the banner of W-13 and `soft_limit_reached`; the push arrives with T-213. Returns true when it was this call.
 */
export async function checkSoftLimit(env: BudgetEnv, nowMs = Date.now()): Promise<boolean> {
  const spent = (await spentMicros(env.DB, nowMs)) / 1e6;
  if (spent < softLimitUsd(env)) return false;
  const month = monthWindow(nowMs);
  const result = await env.DB.prepare(
    `INSERT OR IGNORE INTO token_cache (key, value, expires_at) VALUES (?1, ?2, ?3)`,
  )
    .bind(`ai_soft:${month.key}`, String(nowMs), month.end + DAY_MS)
    .run();
  const first = (result.meta.changes ?? 0) > 0;
  if (first)
    log('warn', 'ai_soft_limit_reached', {
      month: month.key,
      spent_usd: spent,
      budget_usd: Number(env.AI_MONTHLY_BUDGET_USD),
    });
  return first;
}

/** `GET /v1/admin/ai-budget` (03 §12): this month in Mexico City. */
export async function budgetSummary(env: BudgetEnv, nowMs = Date.now()): Promise<AiBudget> {
  const month = monthWindow(nowMs);
  const rows = await env.DB.prepare(
    `SELECT purpose, COALESCE(SUM(cost_usd_micros), 0) AS micros, COUNT(*) AS calls
     FROM ai_usage WHERE created_at >= ?1 AND created_at < ?2 GROUP BY purpose`,
  )
    .bind(month.start, month.end)
    .all<{ purpose: AiPurpose; micros: number; calls: number }>();
  const by_purpose: Record<AiPurpose, number> = { receipt: 0, image_edit: 0, other: 0 };
  let micros = 0;
  let calls = 0;
  for (const r of rows.results) {
    by_purpose[r.purpose] = r.micros / 1e6;
    micros += r.micros;
    calls += r.calls;
  }
  const spent = micros / 1e6;
  return {
    month: month.key,
    budget_usd: Number(env.AI_MONTHLY_BUDGET_USD),
    spent_usd: spent,
    soft_limit_pct: Number(env.AI_SOFT_LIMIT_PCT),
    soft_limit_reached: spent >= softLimitUsd(env),
    by_purpose,
    calls,
  };
}
