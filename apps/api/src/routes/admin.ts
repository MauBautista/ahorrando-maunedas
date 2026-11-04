import { ApiError } from '../errors';
import { sha256Hex } from '../util/sha256';
import { newHaToken } from '../ha/auth';
import { uuidv7 } from '@maunedas/shared/util/uuid';
import {
  HaTokenCreateSchema,
  type HaTokenCreated,
  type HaTokenItem,
  type HaTokensResponse,
} from '@maunedas/shared/api/ha';
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
  .get('/v1/admin/ai-budget', adminOnly, async (c) => c.json<AiBudget>(await budgetSummary(c.env)))

  // Home Assistant's read-only tokens (T-308, 03 §13): only their hash is kept, so a token is shown once.
  .get('/v1/admin/ha-tokens', adminOnly, async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT t.id, t.name, u.display_name AS created_by_name, t.created_at, t.last_used_at, t.revoked_at
       FROM ha_tokens t JOIN users u ON u.id = t.created_by
       ORDER BY t.revoked_at IS NOT NULL, t.created_at DESC, t.id`,
    ).all<HaTokenItem>();
    return c.json<HaTokensResponse>({ items: results });
  })

  .post('/v1/admin/ha-tokens', adminOnly, async (c) => {
    const { name } = await parseJsonBody(c, HaTokenCreateSchema);
    const now = Date.now();
    const user = c.get('user');
    const token = newHaToken();
    const id = uuidv7(now);
    await c.env.DB.prepare(
      'INSERT INTO ha_tokens (id, name, token_sha256, created_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5)',
    )
      .bind(id, name, await sha256Hex(token), user.id, now)
      .run();
    return c.json<HaTokenCreated>(
      {
        id,
        name,
        created_by_name: user.display_name,
        created_at: now,
        last_used_at: null,
        revoked_at: null,
        token,
      },
      201,
    );
  })

  // Revoking keeps the row, so the list still says who made it and when it was last used.
  .delete('/v1/admin/ha-tokens/:id', adminOnly, async (c) => {
    const id = parseParam(c.req.param('id'), z.uuid(), 'id');
    const { meta } = await c.env.DB.prepare(
      'UPDATE ha_tokens SET revoked_at = COALESCE(revoked_at, ?1) WHERE id = ?2',
    )
      .bind(Date.now(), id)
      .run();
    if ((meta.changes ?? 0) === 0) throw new ApiError(404, 'NOT_FOUND');
    return c.body(null, 204);
  });
