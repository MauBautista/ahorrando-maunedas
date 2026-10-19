import { DeviceRegistrationSchema } from '@maunedas/shared/api/devices';
import { Hono } from 'hono';
import { z } from 'zod';
import { requireUser } from '../auth/middleware';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';
import { parseJsonBody, parseParam } from '../util/validate';

/**
 * Devices that receive push notifications (03 §5). `devices` is a SERVER table: physical deletes are fine.
 * The row belongs to whoever registered the install last (a phone can change hands after a sign-out).
 */
export const devices = new Hono<AppEnv>()
  .post('/v1/devices', requireUser(), async (c) => {
    const body = await parseJsonBody(c, DeviceRegistrationSchema);
    const user = c.get('user');
    const now = Date.now();
    const db = c.env.DB;

    const statements: D1PreparedStatement[] = [];
    if (body.fcm_token !== null) {
      // A token identifies one install: if another device row still has it, that row is stale.
      statements.push(
        db
          .prepare('UPDATE devices SET fcm_token = NULL WHERE fcm_token = ?1 AND id <> ?2')
          .bind(body.fcm_token, body.device_id),
      );
    }
    statements.push(
      db
        .prepare(
          `INSERT INTO devices (id, user_id, platform, fcm_token, app_version, last_seen_at, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
           ON CONFLICT(id) DO UPDATE SET
             user_id = excluded.user_id, platform = excluded.platform, fcm_token = excluded.fcm_token,
             app_version = excluded.app_version, last_seen_at = excluded.last_seen_at`,
        )
        .bind(body.device_id, user.id, body.platform, body.fcm_token, body.app_version, now),
    );
    await db.batch(statements);
    return c.body(null, 204);
  })
  .delete('/v1/devices/:deviceId', requireUser(), async (c) => {
    const deviceId = parseParam(c.req.param('deviceId'), z.uuid(), 'deviceId');
    const user = c.get('user');
    const row = await c.env.DB.prepare('SELECT user_id FROM devices WHERE id = ?1')
      .bind(deviceId)
      .first<{ user_id: string }>();
    if (row && row.user_id !== user.id) throw new ApiError(403, 'FORBIDDEN');
    // Unknown device → 204 as well: signing out twice (or after a retry) is not an error.
    if (row) await c.env.DB.prepare('DELETE FROM devices WHERE id = ?1').bind(deviceId).run();
    return c.body(null, 204);
  });
