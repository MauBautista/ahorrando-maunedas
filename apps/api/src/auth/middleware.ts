import type { MiddlewareHandler } from 'hono';
import type { UserRow } from '../db/rows';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';
import { verifyFirebaseToken, type FirebaseClaims } from './firebase-token';

/**
 * Authenticates the Firebase ID token and resolves the household user (02 §5.1). A Firebase account
 * without a linked identity (or an unregistered Google e-mail) is rejected even if it signed in.
 */
export const requireUser =
  (opts: { admin?: boolean } = {}): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    const token = c.req.header('Authorization')?.match(/^Bearer\s+(\S+)$/)?.[1];
    if (!token) throw new ApiError(401, 'UNAUTHENTICATED');

    const claims = await verifyFirebaseToken(token, c.env.FIREBASE_PROJECT_ID, c.get('firebaseKeys'));
    const user = await resolveUser(c.env.DB, claims);
    if (!user) throw new ApiError(403, 'USER_NOT_ALLOWED');
    if (!user.active) throw new ApiError(403, 'USER_DISABLED');
    if (opts.admin && user.role !== 'admin') throw new ApiError(403, 'FORBIDDEN');

    c.set('user', user);
    await next();
  };

/**
 * Linked identity first; otherwise a Google sign-in whose verified e-mail is registered in
 * `users.google_email` (case-insensitive by the column collation) is linked on its first request.
 */
export async function resolveUser(db: D1Database, claims: FirebaseClaims): Promise<UserRow | null> {
  const linked = await db
    .prepare('SELECT u.* FROM user_identities i JOIN users u ON u.id = i.user_id WHERE i.firebase_uid = ?1')
    .bind(claims.sub)
    .first<UserRow>();
  if (linked) return linked;

  if (claims.firebase?.sign_in_provider !== 'google.com' || !claims.email || claims.email_verified !== true) {
    return null;
  }
  const user = await db
    .prepare('SELECT * FROM users WHERE google_email = ?1')
    .bind(claims.email)
    .first<UserRow>();
  if (!user) return null;

  await db
    .prepare(
      `INSERT OR IGNORE INTO user_identities (firebase_uid, user_id, provider, created_at)
       VALUES (?1, ?2, 'google.com', ?3)`,
    )
    .bind(claims.sub, user.id, Date.now())
    .run();
  return user;
}
