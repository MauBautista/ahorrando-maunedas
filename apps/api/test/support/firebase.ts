import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTPayload } from 'jose';

/** Local stand-in for Google's Firebase signing keys (02 §9: JWKS simulated with test keys). */
export async function createTestIssuer(projectId: string) {
  const signing = await generateKeyPair('RS256', { extractable: true });
  const stranger = await generateKeyPair('RS256', { extractable: true });
  const jwk = { ...(await exportJWK(signing.publicKey)), kid: 'test-key-1', alg: 'RS256', use: 'sig' };
  const keys = createLocalJWKSet({ keys: [jwk] });

  type Options = {
    privateKey?: CryptoKey;
    kid?: string;
    expiresInS?: number;
    omit?: Array<keyof JWTPayload>;
  };

  /** A Firebase-like ID token; claims override the defaults and `options.omit` removes registered ones. */
  async function token(claims: Record<string, unknown> = {}, options: Options = {}): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const payload: Record<string, unknown> = {
      iss: `https://securetoken.google.com/${projectId}`,
      aud: projectId,
      sub: 'uid-password-1',
      iat: now - 10,
      exp: now + (options.expiresInS ?? 3600),
      auth_time: now - 10,
      firebase: { sign_in_provider: 'password' },
      ...claims,
    };
    for (const key of options.omit ?? []) delete payload[key];
    return new SignJWT(payload)
      .setProtectedHeader({ alg: 'RS256', kid: options.kid ?? 'test-key-1', typ: 'JWT' })
      .sign(options.privateKey ?? signing.privateKey);
  }

  return { keys, token, strangerKey: stranger.privateKey };
}

/** An unsigned token (`alg: none`), which must never be accepted. */
export function unsignedToken(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64(payload)}.`;
}

export interface TestUser {
  id: string;
  username: string;
  display_name?: string;
  role?: 'admin' | 'member';
  active?: 0 | 1;
  google_email?: string | null;
}

export async function insertUser(db: D1Database, u: TestUser): Promise<void> {
  await db
    .prepare(
      `INSERT INTO users (id, username, display_name, google_email, role, active, created_at, updated_at, version)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, 1, 0)`,
    )
    .bind(
      u.id,
      u.username,
      u.display_name ?? u.username,
      u.google_email ?? null,
      u.role ?? 'member',
      u.active ?? 1,
    )
    .run();
}

export async function linkIdentity(
  db: D1Database,
  firebaseUid: string,
  userId: string,
  provider: 'password' | 'google.com' = 'password',
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO user_identities (firebase_uid, user_id, provider, created_at) VALUES (?1, ?2, ?3, 1)',
    )
    .bind(firebaseUid, userId, provider)
    .run();
}

/** Tests own their rows; physical deletes are fine here (SERVER/DOWN tables in a test database). */
export async function clearUsers(db: D1Database): Promise<void> {
  await db.batch([db.prepare('DELETE FROM user_identities'), db.prepare('DELETE FROM users')]);
}
