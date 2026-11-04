import {
  AgentJobFailSchema,
  type AgentJobClaim,
  type AgentJobResult,
  BackupPullRequestSchema,
  type BackupPullResponse,
  AgentObservationsRequestSchema,
  type AgentObservationsResponse,
  AgentWorkRequestSchema,
  type AgentWorkResponse,
} from '@maunedas/shared/api/agent';
import { MAX_UPLOAD_BYTES } from '@maunedas/shared/api/images';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';
import { mediaType } from '../images/blobs';
import { parseJsonBody, parseParam, parseQuery } from '../util/validate';
import { requireAgent } from './auth';
import { backupPull } from './backup';
import { claimJob, completeJob, failJob, originalOf, RESULT_KINDS, saveResult } from './jobs';
import { fcmDeps } from '../fcm/send';
import { afterIngest, ingest } from './observations';
import { agentWork } from './work';

/** Optional size of a result, as the agent measured it (`?width=&height=`). */
const ResultSizeSchema = z.object({
  width: z.coerce.number().int().positive().max(10_000).optional(),
  height: z.coerce.number().int().positive().max(10_000).optional(),
});

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
  })

  // 07 §5.3 (E3, T-300): image jobs for the home server, one at a time.
  .post('/agent/v1/jobs/claim', requireAgent, async (c) => {
    const job = await claimJob(c.env.DB, Date.now());
    return job ? c.json<AgentJobClaim>({ job }) : c.body(null, 204);
  })

  .get('/agent/v1/images/:imageId/original', requireAgent, async (c) => {
    const imageId = parseParam(c.req.param('imageId'), z.uuid(), 'imageId');
    const object = await originalOf(c.env, imageId);
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('Content-Length', String(object.size));
    return new Response(object.body, { headers });
  })

  .put('/agent/v1/jobs/:jobId/result/:kind', requireAgent, async (c) => {
    const jobId = parseParam(c.req.param('jobId'), z.uuid(), 'jobId');
    const kind = parseParam(c.req.param('kind'), z.enum(['mask', 'processed', 'thumb']), 'kind');
    if (mediaType(c.req.header('Content-Type')) !== RESULT_KINDS[kind].contentType) {
      throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE');
    }
    const length = Number(c.req.header('Content-Length'));
    if (length > MAX_UPLOAD_BYTES) throw new ApiError(413, 'PAYLOAD_TOO_LARGE');
    const body = c.req.raw.body;
    if (!Number.isInteger(length) || length <= 0 || !body) {
      throw new ApiError(400, 'VALIDATION_ERROR', { reason: 'CONTENT_LENGTH_REQUIRED' });
    }
    const size = parseQuery(c, ResultSizeSchema);
    const id = await saveResult(
      c.env,
      jobId,
      kind,
      body,
      length,
      { width: size.width ?? null, height: size.height ?? null },
      Date.now(),
    );
    return c.json<AgentJobResult>({ rendition_id: id }, 201);
  })

  .post('/agent/v1/jobs/:jobId/complete', requireAgent, async (c) => {
    await completeJob(c.env.DB, parseParam(c.req.param('jobId'), z.uuid(), 'jobId'), Date.now());
    return c.body(null, 204);
  })

  .post('/agent/v1/jobs/:jobId/fail', requireAgent, async (c) => {
    const jobId = parseParam(c.req.param('jobId'), z.uuid(), 'jobId');
    const { error } = await parseJsonBody(c, AgentJobFailSchema);
    await failJob(c.env.DB, jobId, error, Date.now());
    return c.body(null, 204);
  });
