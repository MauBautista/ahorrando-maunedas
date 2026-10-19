import { BootstrapRequestSchema, type AdminUser } from '@maunedas/shared/api/admin';
import { Hono } from 'hono';
import { bootstrapTokenMatches } from '../auth/bootstrap';
import { identityToolkitOf } from '../auth/firebase-admin';
import { createUser } from '../auth/users';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';
import { log } from '../util/log';
import { parseJsonBody } from '../util/validate';

/**
 * `POST /v1/bootstrap` (02 §5.4): creates the first admin, once. The token is checked before anything
 * else, then that there are no users, then the body. Delete the secret afterwards.
 */
export const bootstrap = new Hono<AppEnv>().post('/v1/bootstrap', async (c) => {
  if (!(await bootstrapTokenMatches(c.env.BOOTSTRAP_TOKEN, c.req.header('X-Bootstrap-Token')))) {
    throw new ApiError(401, 'UNAUTHENTICATED');
  }
  if (await c.env.DB.prepare('SELECT 1 FROM users LIMIT 1').first())
    throw new ApiError(410, 'ALREADY_BOOTSTRAPPED');

  const body = await parseJsonBody(c, BootstrapRequestSchema);
  const user = await createUser(
    c.env.DB,
    identityToolkitOf(c),
    c.env,
    { ...body, role: 'admin' },
    Date.now(),
    {
      onlyIfNoUsers: true,
    },
  );
  log('info', 'first admin created; delete BOOTSTRAP_TOKEN', {
    request_id: c.get('requestId'),
    user_id: user.id,
  });
  return c.json<{ user: AdminUser }>({ user }, 201);
});
