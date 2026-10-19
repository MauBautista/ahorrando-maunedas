import { env } from 'cloudflare:workers';
import { errors } from 'jose';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { requireUser } from '../src/auth/middleware';
import { clearUsers, createTestIssuer, insertUser, linkIdentity, unsignedToken } from './support/firebase';

let issuer: Awaited<ReturnType<typeof createTestIssuer>>;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  issuer = await createTestIssuer(env.FIREBASE_PROJECT_ID);
  app = createApp({
    firebaseKeys: issuer.keys,
    extraRoutes: (a) => {
      a.get('/v1/__test/admin-only', requireUser({ admin: true }), (c) => c.json({ ok: true }));
    },
  });
});

beforeEach(async () => {
  await clearUsers(env.DB);
  await insertUser(env.DB, {
    id: 'u-admin',
    username: 'mau',
    display_name: 'Mauricio',
    role: 'admin',
    google_email: 'mau@gmail.com',
  });
  await insertUser(env.DB, { id: 'u-member', username: 'pepe', role: 'member' });
  await insertUser(env.DB, {
    id: 'u-off',
    username: 'ex',
    role: 'member',
    active: 0,
    google_email: 'ex@gmail.com',
  });
  await linkIdentity(env.DB, 'uid-mau-password', 'u-admin');
  await linkIdentity(env.DB, 'uid-pepe-password', 'u-member');
  await linkIdentity(env.DB, 'uid-ex-password', 'u-off');
});

const get = (path: string, token?: string) =>
  app.request(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} }, env as never);

async function errorCode(res: Response): Promise<string> {
  return (await res.json<{ error: { code: string } }>()).error.code;
}

const google = (sub: string, email: string, emailVerified = true) => ({
  sub,
  email,
  email_verified: emailVerified,
  firebase: { sign_in_provider: 'google.com' },
});

describe('requireUser · token (02 §9)', () => {
  it('without Authorization → 401 UNAUTHENTICATED', async () => {
    const res = await get('/v1/me');
    expect(res.status).toBe(401);
    expect(await errorCode(res)).toBe('UNAUTHENTICATED');
  });

  it.each([
    ['garbage', async () => 'not-a-jwt'],
    [
      'signed with another key',
      async () => issuer.token({ sub: 'uid-mau-password' }, { privateKey: issuer.strangerKey }),
    ],
    ['unknown key id', async () => issuer.token({ sub: 'uid-mau-password' }, { kid: 'other-kid' })],
    [
      'foreign iss',
      async () => issuer.token({ sub: 'uid-mau-password', iss: 'https://securetoken.google.com/otro' }),
    ],
    ['foreign aud', async () => issuer.token({ sub: 'uid-mau-password', aud: 'otro-proyecto' })],
    ['expired', async () => issuer.token({ sub: 'uid-mau-password' }, { expiresInS: -120 })],
    ['without sub', async () => issuer.token({}, { omit: ['sub'] })],
    ['alg none', async () => unsignedToken({ sub: 'uid-mau-password', aud: env.FIREBASE_PROJECT_ID })],
  ])('%s → 401 INVALID_TOKEN', async (_case, make) => {
    const res = await get('/v1/me', await make());
    expect(res.status).toBe(401);
    expect(await errorCode(res)).toBe('INVALID_TOKEN');
  });

  it('when Google keys cannot be fetched → 502 UPSTREAM_ERROR, not a bad token', async () => {
    const token = await issuer.token({ sub: 'uid-mau-password' });
    for (const failure of [new TypeError('network down'), new errors.JWKSTimeout()]) {
      const offline = createApp({
        firebaseKeys: async () => {
          throw failure;
        },
      });
      const res = await offline.request(
        '/v1/me',
        { headers: { Authorization: `Bearer ${token}` } },
        env as never,
      );
      expect(res.status).toBe(502);
      expect(await errorCode(res)).toBe('UPSTREAM_ERROR');
    }
  });
});

describe('requireUser · identity (02 §9)', () => {
  it('valid token for a linked identity → 200 with /v1/me', async () => {
    const res = await get('/v1/me', await issuer.token({ sub: 'uid-mau-password' }));
    expect(res.status).toBe(200);
    const body = await res.json<Record<string, unknown>>();
    expect(body).toMatchObject({
      user: { id: 'u-admin', username: 'mau', display_name: 'Mauricio', role: 'admin', has_google: true },
      schema_version: 1,
      min_client_schema: 1,
    });
    expect(typeof body.server_time).toBe('number');
  });

  it('valid token without identity → 403 USER_NOT_ALLOWED', async () => {
    const res = await get(
      '/v1/me',
      await issuer.token({ sub: 'uid-self-signed-up', email: 'mau@maunedas.local' }),
    );
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe('USER_NOT_ALLOWED');
  });

  it('Google with a registered e-mail → links the identity and answers 200', async () => {
    const token = await issuer.token(google('uid-mau-google', 'mau@gmail.com'));
    const res = await get('/v1/me', token);
    expect(res.status).toBe(200);
    expect((await res.json<{ user: { id: string } }>()).user.id).toBe('u-admin');
    const identity = await env.DB.prepare(
      'SELECT user_id, provider FROM user_identities WHERE firebase_uid = ?1',
    )
      .bind('uid-mau-google')
      .first();
    expect(identity).toEqual({ user_id: 'u-admin', provider: 'google.com' });
    // The second request resolves through the linked identity.
    expect((await get('/v1/me', token)).status).toBe(200);
  });

  it('Google e-mail matching is case-insensitive', async () => {
    const res = await get('/v1/me', await issuer.token(google('uid-mau-google-2', 'Mau@Gmail.com')));
    expect(res.status).toBe(200);
  });

  it('Google with email_verified=false → 403 USER_NOT_ALLOWED and nothing linked', async () => {
    const res = await get('/v1/me', await issuer.token(google('uid-unverified', 'mau@gmail.com', false)));
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe('USER_NOT_ALLOWED');
    const linked = await env.DB.prepare('SELECT count(*) AS n FROM user_identities WHERE firebase_uid = ?1')
      .bind('uid-unverified')
      .first<{ n: number }>();
    expect(linked?.n).toBe(0);
  });

  it('Google with an unregistered e-mail → 403 USER_NOT_ALLOWED', async () => {
    const res = await get('/v1/me', await issuer.token(google('uid-stranger', 'stranger@gmail.com')));
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe('USER_NOT_ALLOWED');
  });

  it('a password sign-in never links by e-mail, even if it matches a Google e-mail', async () => {
    const res = await get(
      '/v1/me',
      await issuer.token({ sub: 'uid-password-x', email: 'mau@gmail.com', email_verified: true }),
    );
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe('USER_NOT_ALLOWED');
  });

  it('inactive user → 403 USER_DISABLED (linked or through Google)', async () => {
    for (const token of [
      await issuer.token({ sub: 'uid-ex-password' }),
      await issuer.token(google('uid-ex-google', 'ex@gmail.com')),
    ]) {
      const res = await get('/v1/me', token);
      expect(res.status).toBe(403);
      expect(await errorCode(res)).toBe('USER_DISABLED');
    }
  });

  it('admin-only routes: member → 403 FORBIDDEN, admin → 200', async () => {
    const member = await get('/v1/__test/admin-only', await issuer.token({ sub: 'uid-pepe-password' }));
    expect(member.status).toBe(403);
    expect(await errorCode(member)).toBe('FORBIDDEN');
    const admin = await get('/v1/__test/admin-only', await issuer.token({ sub: 'uid-mau-password' }));
    expect(admin.status).toBe(200);
  });

  it('has_google is false for users without a Google e-mail', async () => {
    const res = await get('/v1/me', await issuer.token({ sub: 'uid-pepe-password' }));
    expect((await res.json<{ user: { has_google: boolean } }>()).user.has_google).toBe(false);
  });
});
