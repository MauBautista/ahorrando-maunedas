import {
  BackupPullRequestSchema,
  type BackupPullResponse,
  AgentObservationsRequestSchema,
  type AgentObservationsResponse,
  AgentWorkRequestSchema,
  type AgentWorkResponse,
} from '@maunedas/shared/api/agent';
import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';
import { parseJsonBody } from '../util/validate';
import { requireAgent } from './auth';
import { backupPull } from './backup';
import { fcmDeps } from '../fcm/send';
import { afterIngest, ingest } from './observations';
import { agentWork } from './work';

/** `info` as stored in `agent_status` stays small whatever the agent adds to it. */
const MAX_INFO_CHARS = 4000;

/** `/agent/v1/*` (07 §5): only the home agent, with its token (CLAUDE.md rule 9). */
export const agent = new Hono<AppEnv>()
  .post('/agent/v1/work', requireAgent, async (c) => {
    const body = await parseJsonBody(c, AgentWorkRequestSchema);
    if (JSON.stringify(body.info).length > MAX_INFO_CHARS) throw new ApiError(413, 'PAYLOAD_TOO_LARGE');
    return c.json<AgentWorkResponse>(await agentWork(c.env.DB, body, Date.now()));
  })

  // 07 §5.2, §6: the checks of 1 to 20 listings; alerts and notices go after the answer.
  .post('/agent/v1/observations', requireAgent, async (c) => {
    const { results } = await parseJsonBody(c, AgentObservationsRequestSchema);
    const result = await ingest(c.env.DB, results, Date.now());
    const deps = fcmDeps(c.get('outboundFetch'), c.get('googleTokens'));
    c.executionCtx.waitUntil(afterIngest(c.env, result, Date.now(), deps));
    return c.json<AgentObservationsResponse>({
      accepted: result.accepted,
      observations_created: result.created.length,
    });
  })

  // 07 §5.4, §10: the home mirror's increments.
  .post('/agent/v1/backup/pull', requireAgent, async (c) => {
    const body = await parseJsonBody(c, BackupPullRequestSchema);
    return c.json<BackupPullResponse>(await backupPull(c.env.DB, body, Date.now()));
  });
