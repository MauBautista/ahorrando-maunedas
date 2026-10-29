import { AgentWorkRequestSchema, type AgentWorkResponse } from '@maunedas/shared/api/agent';
import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';
import { parseJsonBody } from '../util/validate';
import { requireAgent } from './auth';
import { agentWork } from './work';

/** `info` as stored in `agent_status` stays small whatever the agent adds to it. */
const MAX_INFO_CHARS = 4000;

/** `/agent/v1/*` (07 §5): only the home agent, with its token (CLAUDE.md rule 9). */
export const agent = new Hono<AppEnv>().post('/agent/v1/work', requireAgent, async (c) => {
  const body = await parseJsonBody(c, AgentWorkRequestSchema);
  if (JSON.stringify(body.info).length > MAX_INFO_CHARS) throw new ApiError(413, 'PAYLOAD_TOO_LARGE');
  return c.json<AgentWorkResponse>(await agentWork(c.env.DB, body, Date.now()));
});
