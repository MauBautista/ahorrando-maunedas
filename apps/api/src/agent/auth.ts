import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';

const enc = new TextEncoder();
const HEX = /^[0-9a-f]{64}$/;

async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(value)));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The home agent's bearer token (07 §5, CLAUDE.md rule 9): the Worker keeps only its SHA-256 (`AGENT_TOKEN_SHA256`)
 * and compares in constant time. A missing or wrong token, or no hash configured, is `401`.
 */
export const requireAgent: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = c.req.header('Authorization')?.match(/^Bearer\s+(\S+)$/)?.[1];
  const expected = (c.env.AGENT_TOKEN_SHA256 ?? '').trim().toLowerCase();
  if (!token || !HEX.test(expected)) throw new ApiError(401, 'UNAUTHENTICATED');
  const given = await sha256Hex(token);
  if (!crypto.subtle.timingSafeEqual(enc.encode(given), enc.encode(expected))) {
    throw new ApiError(401, 'UNAUTHENTICATED');
  }
  await next();
};
