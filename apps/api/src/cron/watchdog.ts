import { AGENT_OFFLINE_MARK } from '../agent/work';
import { systemMessage } from '../alerts/messages';
import type { Env } from '../env';
import { notifyAdmins } from '../fcm/deliver';
import type { FcmDeps } from '../fcm/send';

/** "Agente sin heartbeat ≥ 2 h" (08 §5). */
export const OFFLINE_ALERT_MS = 2 * 3_600_000;
/** The mark outlives any outage; a heartbeat clears it before then (07 §5.1). */
const MARK_TTL_MS = 30 * 86_400_000;

/**
 * The hourly watchdog of the home agent (T-214): when its last heartbeat is [OFFLINE_ALERT_MS] old or more, the
 * admins are told once per outage. The mark `agent_offline_notified` is claimed before sending, and `/agent/v1/work`
 * clears it when the agent comes back. An agent that never connected is not missed. Returns whether it warned now.
 */
export async function runWatchdog(
  env: Pick<Env, 'DB' | 'GOOGLE_SERVICE_ACCOUNT' | 'FIREBASE_PROJECT_ID'>,
  deps: FcmDeps,
  now: number,
): Promise<boolean> {
  const last = await env.DB.prepare('SELECT MAX(last_heartbeat_at) AS at FROM agent_status').first<
    number | null
  >('at');
  if (last === null || now - last < OFFLINE_ALERT_MS) return false;
  const claim = await env.DB.prepare(
    'INSERT OR IGNORE INTO token_cache (key, value, expires_at) VALUES (?1, ?2, ?3)',
  )
    .bind(AGENT_OFFLINE_MARK, String(now), now + MARK_TTL_MS)
    .run();
  if ((claim.meta.changes ?? 0) === 0) return false;
  const { title, body } = systemMessage.agentOffline(last, now);
  await notifyAdmins(env, deps, title, body);
  return true;
}
