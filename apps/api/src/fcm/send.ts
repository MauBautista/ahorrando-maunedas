import type { AccessTokenSource } from '../auth/firebase-admin';
import type { Env } from '../env';
import { log } from '../util/log';

export type FcmOutcome = 'sent' | 'unregistered' | 'failed';
export type FcmEnv = Pick<Env, 'DB' | 'GOOGLE_SERVICE_ACCOUNT' | 'FIREBASE_PROJECT_ID'>;

/**
 * What sending needs, injected so tests fake Google. [budget] is how many messages this invocation may still send:
 * the Free plan allows 50 subrequests per invocation (08 §6), and D1 calls count too.
 */
export interface FcmDeps {
  fetch: typeof fetch;
  tokens: AccessTokenSource;
  budget: { left: number };
}

/** Messages one invocation sends at most; the rest of its 50 subrequests stay for D1 and Google's token. */
export const FCM_SENDS_PER_INVOCATION = 40;

export function fcmDeps(fetchImpl: typeof fetch, tokens: AccessTokenSource): FcmDeps {
  return { fetch: fetchImpl, tokens, budget: { left: FCM_SENDS_PER_INVOCATION } };
}

/**
 * One data-only message, high priority (08 §6): the app builds the notification, so it behaves the same in front
 * and in the background. A token Firebase no longer knows is `unregistered`.
 */
export async function sendFcm(
  env: FcmEnv,
  deps: FcmDeps,
  token: string,
  data: Record<string, string>,
): Promise<FcmOutcome> {
  if (deps.budget.left <= 0) {
    log('warn', 'fcm_budget_exhausted');
    return 'failed';
  }
  deps.budget.left--;
  try {
    const access = await deps.tokens.get(env);
    const res = await deps.fetch(
      `https://fcm.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/messages:send`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: { token, data, android: { priority: 'HIGH', ttl: '86400s' } } }),
      },
    );
    if (res.ok) return 'sent';
    if (res.status === 404) return 'unregistered';
    const body = await res.text().catch(() => '');
    if (body.includes('UNREGISTERED')) return 'unregistered';
    log('warn', 'fcm_failed', { status: res.status });
    return 'failed';
  } catch (e) {
    log('error', 'fcm_failed', { error: e instanceof Error ? e.message : String(e) });
    return 'failed';
  }
}
