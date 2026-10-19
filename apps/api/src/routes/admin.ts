import {
  CreateUserRequestSchema,
  MergeRequestSchema,
  SetPasswordRequestSchema,
  UpdateUserRequestSchema,
  type AdminUser,
  type MergeResponse,
} from '@maunedas/shared/api/admin';
import { Hono } from 'hono';
import { z } from 'zod';
import { identityToolkitOf as identityOf } from '../auth/firebase-admin';
import { requireUser } from '../auth/middleware';
import { createUser, listUsers, setUserPassword, updateUser } from '../auth/users';
import { mergeDuplicates } from '../db/queries/merge';
import type { AppEnv } from '../env';
import { parseJsonBody, parseParam } from '../util/validate';

const adminOnly = requireUser({ admin: true });

/** Admin routes (03 §12). The AI budget arrives with T-039 and the agent status with E2. */
export const admin = new Hono<AppEnv>()
  .get('/v1/admin/users', adminOnly, async (c) =>
    c.json<{ items: AdminUser[] }>({ items: await listUsers(c.env.DB) }),
  )

  .post('/v1/admin/users', adminOnly, async (c) => {
    const body = await parseJsonBody(c, CreateUserRequestSchema);
    const user = await createUser(c.env.DB, identityOf(c), c.env, body, Date.now());
    return c.json<{ user: AdminUser }>({ user }, 201);
  })

  .patch('/v1/admin/users/:id', adminOnly, async (c) => {
    const id = parseParam(c.req.param('id'), z.uuid(), 'id');
    const patch = await parseJsonBody(c, UpdateUserRequestSchema);
    const user = await updateUser(c.env.DB, identityOf(c), id, patch, Date.now());
    return c.json<{ user: AdminUser }>({ user });
  })

  .post('/v1/admin/users/:id/password', adminOnly, async (c) => {
    const id = parseParam(c.req.param('id'), z.uuid(), 'id');
    const { password } = await parseJsonBody(c, SetPasswordRequestSchema);
    await setUserPassword(c.env.DB, identityOf(c), c.env, id, password, Date.now());
    return c.body(null, 204);
  })

  .post('/v1/admin/merge', adminOnly, async (c) => {
    const { kind, source_id, target_id } = await parseJsonBody(c, MergeRequestSchema);
    const moved = await mergeDuplicates(c.env.DB, kind, source_id, target_id, c.get('user').id, Date.now());
    return c.json<MergeResponse>({ moved });
  });
