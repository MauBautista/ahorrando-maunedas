import type { DeliveryStatus } from '@maunedas/shared/api/alerts';
import { type FcmDeps, type FcmEnv, sendFcm } from './send';

/** At most this many messages in flight at once (08 §6). */
const PARALLEL = 6;

/**
 * A message to every device of a user with a token (08 §6): `sent` when all got it, `partial` when some did,
 * `failed` when none did, `no_devices` without tokens. A token Firebase no longer knows is forgotten (case 12).
 */
export async function sendToUser(
  env: FcmEnv,
  deps: FcmDeps,
  userId: string,
  data: Record<string, string>,
): Promise<DeliveryStatus> {
  const { results: devices } = await env.DB.prepare(
    'SELECT id, fcm_token FROM devices WHERE user_id = ?1 AND fcm_token IS NOT NULL ORDER BY id',
  )
    .bind(userId)
    .all<{ id: string; fcm_token: string }>();
  if (devices.length === 0) return 'no_devices';
  const outcomes: string[] = [];
  for (let i = 0; i < devices.length; i += PARALLEL) {
    const chunk = devices.slice(i, i + PARALLEL);
    outcomes.push(...(await Promise.all(chunk.map((d) => sendFcm(env, deps, d.fcm_token, data)))));
  }
  const gone = devices.filter((_, i) => outcomes[i] === 'unregistered').map((d) => d.id);
  if (gone.length > 0) {
    await env.DB.prepare('UPDATE devices SET fcm_token = NULL WHERE id IN (SELECT value FROM json_each(?1))')
      .bind(JSON.stringify(gone))
      .run();
  }
  const sent = outcomes.filter((o) => o === 'sent').length;
  return sent === devices.length ? 'sent' : sent > 0 ? 'partial' : 'failed';
}

/** A system notice to every active admin (08 §5); it makes no `alert_event`. */
export async function notifyAdmins(env: FcmEnv, deps: FcmDeps, title: string, body: string): Promise<void> {
  const { results: admins } = await env.DB.prepare(
    `SELECT id FROM users WHERE role = 'admin' AND active = 1 ORDER BY id`,
  ).all<{ id: string }>();
  for (const admin of admins) {
    await sendToUser(env, deps, admin.id, { type: 'system', title, body, channel: 'system' });
  }
}
