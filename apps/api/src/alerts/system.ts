import { budgetSummary, monthWindow } from '../ai/budget';
import type { Env } from '../env';
import { notifyAdmins } from '../fcm/deliver';
import type { FcmDeps } from '../fcm/send';
import { systemMessage } from './messages';

const DAY_MS = 86_400_000;

/**
 * "Gasto de IA al 80 %" to the admins (08 §5), once a month: the gateway marks `ai_soft:<YYYY-MM>` when a call
 * crosses the soft limit (09 §2); the hourly Cron sends the notice and marks `ai_soft_sent:<YYYY-MM>`, so the
 * gateway never waits on Firebase. Returns whether it was sent now.
 */
export async function notifySoftLimit(
  env: Pick<
    Env,
    'DB' | 'GOOGLE_SERVICE_ACCOUNT' | 'FIREBASE_PROJECT_ID' | 'AI_MONTHLY_BUDGET_USD' | 'AI_SOFT_LIMIT_PCT'
  >,
  deps: FcmDeps,
  now: number,
): Promise<boolean> {
  const month = monthWindow(now);
  const reached = await env.DB.prepare('SELECT 1 FROM token_cache WHERE key = ?1')
    .bind(`ai_soft:${month.key}`)
    .first();
  if (!reached) return false;
  // Claimed before sending, so two ticks never send it twice.
  const claim = await env.DB.prepare(
    'INSERT OR IGNORE INTO token_cache (key, value, expires_at) VALUES (?1, ?2, ?3)',
  )
    .bind(`ai_soft_sent:${month.key}`, String(now), month.end + DAY_MS)
    .run();
  if ((claim.meta.changes ?? 0) === 0) return false;
  const summary = await budgetSummary(env, now);
  const { title, body } = systemMessage.aiSoftLimit(summary.spent_usd, summary.budget_usd);
  await notifyAdmins(env, deps, title, body);
  return true;
}
