import { PullRequestSchema, PUSH_MAX_BYTES, PushRequestSchema } from '@maunedas/shared/api/sync';
import { Hono } from 'hono';
import { requireUser } from '../auth/middleware';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';
import { pullChanges } from '../sync/pull';
import { pushMutations } from '../sync/push';
import { parseJsonBody, parseJsonText } from '../util/validate';

/** Sync endpoints (04 §3–4). `X-Client-Schema` is required here (client-schema middleware). */
export const sync = new Hono<AppEnv>()
  .post('/v1/sync/pull', requireUser(), async (c) => {
    const body = await parseJsonBody(c, PullRequestSchema);
    return c.json(await pullChanges(c.env.DB, c.get('user'), body, Date.now()));
  })
  .post('/v1/sync/push', requireUser(), async (c) => {
    if (Number(c.req.header('Content-Length') ?? 0) > PUSH_MAX_BYTES)
      throw new ApiError(413, 'PAYLOAD_TOO_LARGE');
    const text = await c.req.text();
    if (new TextEncoder().encode(text).byteLength > PUSH_MAX_BYTES)
      throw new ApiError(413, 'PAYLOAD_TOO_LARGE');
    const body = parseJsonText(text, PushRequestSchema);
    return c.json(await pushMutations(c.env.DB, c.get('user'), body.mutations, Date.now()));
  });
