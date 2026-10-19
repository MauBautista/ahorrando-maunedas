import { MergeRequestSchema, type MergeResponse } from '@maunedas/shared/api/admin';
import { Hono } from 'hono';
import { requireUser } from '../auth/middleware';
import { mergeDuplicates } from '../db/queries/merge';
import type { AppEnv } from '../env';
import { parseJsonBody } from '../util/validate';

/** Admin routes (03 §12). Users and the AI budget arrive with T-023 and T-039. */
export const admin = new Hono<AppEnv>().post('/v1/admin/merge', requireUser({ admin: true }), async (c) => {
  const { kind, source_id, target_id } = await parseJsonBody(c, MergeRequestSchema);
  const moved = await mergeDuplicates(c.env.DB, kind, source_id, target_id, c.get('user').id, Date.now());
  return c.json<MergeResponse>({ moved });
});
