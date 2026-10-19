import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';

/**
 * `X-Client-Schema` (03 §1): validated only when present, because signed image URLs, the AI provider,
 * the auth proxy and the agent do not send it; required on `/v1/sync/*`.
 */
export const clientSchema: MiddlewareHandler<AppEnv> = async (c, next) => {
  const raw = c.req.header('X-Client-Schema');
  if (raw === undefined) {
    if (c.req.path.startsWith('/v1/sync/')) {
      throw new ApiError(400, 'VALIDATION_ERROR', { header: 'X-Client-Schema', reason: 'required' });
    }
    return next();
  }
  if (!/^\d+$/.test(raw.trim())) {
    throw new ApiError(400, 'VALIDATION_ERROR', { header: 'X-Client-Schema', reason: 'not_an_integer' });
  }
  const min = Number(c.env.MIN_CLIENT_SCHEMA);
  if (Number(raw) < min) throw new ApiError(426, 'UPGRADE_REQUIRED', { min_client_schema: min });
  await next();
};
