import type { Context } from 'hono';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';

/** Request headers never sent upstream: our API's bearer token has nothing to do with Firebase Hosting. */
const DROPPED = ['authorization'];

/**
 * Transparent proxy of `/__/auth/*` and `/__/firebase/*` to `https://<project>.firebaseapp.com` (02 §5.5), so
 * the web's `authDomain` is its own host and Google sign-in works in Safari without third-party storage
 * (decision T19). Redirects are not followed: the browser gets them as they are.
 */
export async function firebaseAuthProxy(c: Context<AppEnv>): Promise<Response> {
  const url = new URL(c.req.url);
  const upstream = new URL(url.pathname + url.search, `https://${c.env.FIREBASE_PROJECT_ID}.firebaseapp.com`);
  const headers = new Headers(c.req.raw.headers);
  for (const name of DROPPED) headers.delete(name);
  const method = c.req.method;
  try {
    return await c.get('outboundFetch')(upstream.href, {
      method,
      headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : c.req.raw.body,
      redirect: 'manual',
    });
  } catch {
    throw new ApiError(502, 'UPSTREAM_ERROR', { service: 'firebase_hosting' });
  }
}
