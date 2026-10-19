import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../env';

const SAFE_ID = /^[A-Za-z0-9._:-]{8,128}$/;

/** Reuses a well-formed incoming `X-Request-Id` or creates one, and always echoes it (03 §1). */
export const requestId: MiddlewareHandler<AppEnv> = async (c, next) => {
  const incoming = c.req.header('X-Request-Id');
  const id = incoming && SAFE_ID.test(incoming) ? incoming : crypto.randomUUID();
  c.set('requestId', id);
  await next();
  try {
    c.res.headers.set('X-Request-Id', id);
  } catch {
    // Responses passed through from fetch() (auth proxy, assets) have immutable headers.
    c.res = new Response(c.res.body, c.res);
    c.res.headers.set('X-Request-Id', id);
  }
};
