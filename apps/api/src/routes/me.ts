import type { MeResponse } from '@maunedas/shared/api/me';
import { Hono } from 'hono';
import { requireUser } from '../auth/middleware';
import { readSyncMeta } from '../db/meta';
import type { AppEnv } from '../env';

/** Session (03 §5). */
export const me = new Hono<AppEnv>().get('/v1/me', requireUser(), async (c) => {
  const user = c.get('user');
  const { schemaVersion } = await readSyncMeta(c.env.DB);
  return c.json<MeResponse>({
    user: {
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      role: user.role,
      has_google: user.google_email !== null,
    },
    server_time: Date.now(),
    schema_version: schemaVersion,
    min_client_schema: Number(c.env.MIN_CLIENT_SCHEMA),
  });
});
