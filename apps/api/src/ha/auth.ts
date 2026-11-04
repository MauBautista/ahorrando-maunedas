import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';
import { sha256Hex } from '../util/sha256';

/** `last_used_at` is written at most once an hour per token, so reading costs no writes most of the time. */
const LAST_USED_EVERY_MS = 3_600_000;

/**
 * Home Assistant's read-only bearer token (T-308, 03 §13): looked up by its SHA-256 among the live ones.
 * Missing, unknown or revoked is `401`. It only opens `/ha/v1/*`; `/v1` asks for a user session.
 */
export const requireHaToken: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = c.req.header('Authorization')?.match(/^Bearer\s+(\S+)$/)?.[1];
  if (!token) throw new ApiError(401, 'UNAUTHENTICATED');
  const now = Date.now();
  const row = await c.env.DB.prepare(
    'SELECT id, last_used_at FROM ha_tokens WHERE token_sha256 = ?1 AND revoked_at IS NULL',
  )
    .bind(await sha256Hex(token))
    .first<{ id: string; last_used_at: number | null }>();
  if (!row) throw new ApiError(401, 'UNAUTHENTICATED');
  if (row.last_used_at === null || now - row.last_used_at >= LAST_USED_EVERY_MS) {
    c.executionCtx.waitUntil(
      c.env.DB.prepare('UPDATE ha_tokens SET last_used_at = ?1 WHERE id = ?2').bind(now, row.id).run(),
    );
  }
  await next();
};

/** A new token: a prefix that says what it is, and 32 random bytes in base64url. */
export function newHaToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const b64 = btoa(String.fromCharCode(...bytes));
  return `mha_${b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}
