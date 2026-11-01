import {
  CreateUserRequestSchema,
  MergeRequestSchema,
  SetPasswordRequestSchema,
  UpdateUserRequestSchema,
  type AdminUser,
  type AiBudget,
  type MergeResponse,
} from '@maunedas/shared/api/admin';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AdminAgentResponse, AgentStatusRow } from '@maunedas/shared/api/agent';
import { ONLINE_MS } from '../agent/work';
import { budgetSummary } from '../ai/budget';
import { identityToolkitOf as identityOf } from '../auth/firebase-admin';
import { requireUser } from '../auth/middleware';
import { createUser, listUsers, setUserPassword, updateUser } from '../auth/users';
import { mergeDuplicates } from '../db/queries/merge';
import type { AppEnv } from '../env';
import { parseJsonBody, parseParam } from '../util/validate';

const adminOnly = requireUser({ admin: true });

/** Admin routes (03 §12). The agent status arrives with E2. */
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
    const { kind, source_id, target_id, dry_run } = await parseJsonBody(c, MergeRequestSchema);
    const moved = await mergeDuplicates(
      c.env.DB,
      kind,
      source_id,
      target_id,
      c.get('user').id,
      Date.now(),
      dry_run === true,
    );
    return c.json<MergeResponse>({ moved });
  })

  // The home agent at a glance (W-22): its status, whether it is online, and listings in trouble.
  .get('/v1/admin/agent', adminOnly, async (c) => {
    const db = c.env.DB;
    const [status, blocked, failing, jobs] = await db.batch<Record<string, unknown>>([
      db.prepare('SELECT * FROM agent_status ORDER BY last_heartbeat_at DESC LIMIT 1'),
      db.prepare(
        `SELECT count(*) AS n FROM listing_state s JOIN listings l ON l.id = s.listing_id
         WHERE l.deleted_at IS NULL AND s.last_status = 'blocked'`,
      ),
      db.prepare(
        `SELECT count(*) AS n FROM listing_state s JOIN listings l ON l.id = s.listing_id
         WHERE l.deleted_at IS NULL AND s.consecutive_failures > 0`,
      ),
      db.prepare(`SELECT count(*) AS n FROM image_jobs WHERE status = 'queued'`),
    ]);
    const row = status!.results[0] as (Omit<AgentStatusRow, 'info'> & { info: string | null }) | undefined;
    const count = (r: D1Result<Record<string, unknown>> | undefined) => Number(r?.results[0]?.n ?? 0);
    return c.json<AdminAgentResponse>({
      status: row
        ? { ...row, info: row.info ? (JSON.parse(row.info) as Record<string, unknown>) : null }
        : null,
      online: row?.last_heartbeat_at != null && Date.now() - row.last_heartbeat_at < ONLINE_MS,
      blocked_listings: count(blocked),
      failing_listings: count(failing),
      queued_image_jobs: count(jobs),
    });
  })

  // The month's AI spend and its soft limit (09 §2): the banner of W-13.
  .get('/v1/admin/ai-budget', adminOnly, async (c) => c.json<AiBudget>(await budgetSummary(c.env)));
