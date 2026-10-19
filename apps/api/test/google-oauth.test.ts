import { env } from 'cloudflare:workers';
import { jwtVerify } from 'jose';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '../src/errors';
import { GoogleTokenSource } from '../src/google/oauth';
import { createTestServiceAccount, fakeTokenEndpoint } from './support/google';

let sa: Awaited<ReturnType<typeof createTestServiceAccount>>;
const T0 = 1_792_389_600_000;

beforeAll(async () => {
  sa = await createTestServiceAccount();
});

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM token_cache').run();
});

/** `null` = the secret is not configured at all. */
const tokenEnv = (serviceAccount: string | null = sa.json) => ({
  DB: env.DB,
  GOOGLE_SERVICE_ACCOUNT: (serviceAccount ?? undefined) as string,
});

function clockAt(ms: number) {
  const clock = { now: ms };
  return { clock, now: () => clock.now };
}

async function cachedRow() {
  return env.DB.prepare("SELECT value, expires_at FROM token_cache WHERE key = 'google_oauth'").first();
}

describe('GoogleTokenSource (02 §5.2)', () => {
  it('cold start: signs a JWT bearer assertion, exchanges it and caches the token in D1', async () => {
    const google = fakeTokenEndpoint();
    const { now } = clockAt(T0);
    const source = new GoogleTokenSource({ fetch: google.fetch, now });

    expect(await source.get(tokenEnv())).toBe('token-1');
    expect(google.calls).toHaveLength(1);
    const call = google.calls[0]!;
    expect(call.url).toBe('https://oauth2.googleapis.com/token');
    expect(call.body.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');

    const { payload, protectedHeader } = await jwtVerify(call.body.get('assertion')!, sa.publicKey, {
      audience: 'https://oauth2.googleapis.com/token',
      currentDate: new Date(T0),
    });
    expect(protectedHeader).toMatchObject({ alg: 'RS256', kid: 'test-key-id' });
    expect(payload).toMatchObject({
      iss: 'firebase-adminsdk@maunedas-test.iam.gserviceaccount.com',
      sub: 'firebase-adminsdk@maunedas-test.iam.gserviceaccount.com',
      scope:
        'https://www.googleapis.com/auth/firebase.messaging https://www.googleapis.com/auth/identitytoolkit',
    });
    expect(payload.exp! - payload.iat!).toBe(3600);
    expect(await cachedRow()).toEqual({ value: 'token-1', expires_at: T0 + 3599 * 1000 });
  });

  it('reuses the token from memory while it is valid', async () => {
    const google = fakeTokenEndpoint();
    const { clock, now } = clockAt(T0);
    const source = new GoogleTokenSource({ fetch: google.fetch, now });
    await source.get(tokenEnv());
    clock.now = T0 + 30 * 60_000;
    expect(await source.get(tokenEnv())).toBe('token-1');
    expect(google.calls).toHaveLength(1);
  });

  it('a new isolate reuses the token cached in D1 instead of calling Google', async () => {
    const google = fakeTokenEndpoint();
    await new GoogleTokenSource({ fetch: google.fetch, now: () => T0 }).get(tokenEnv());

    const otherIsolate = new GoogleTokenSource({ fetch: google.fetch, now: () => T0 + 10 * 60_000 });
    expect(await otherIsolate.get(tokenEnv())).toBe('token-1');
    expect(google.calls).toHaveLength(1);
  });

  it('renews a minute before expiry and overwrites the cache', async () => {
    const google = fakeTokenEndpoint({ expiresIn: 3600 });
    const { clock, now } = clockAt(T0);
    const source = new GoogleTokenSource({ fetch: google.fetch, now });
    await source.get(tokenEnv());

    clock.now = T0 + 3600_000 - 59_000; // inside the last minute
    expect(await source.get(tokenEnv())).toBe('token-2');
    expect(google.calls).toHaveLength(2);
    expect(await cachedRow()).toEqual({ value: 'token-2', expires_at: clock.now + 3600_000 });

    // A fresh isolate also sees the renewed token, not the expired one.
    const fresh = new GoogleTokenSource({ fetch: google.fetch, now });
    expect(await fresh.get(tokenEnv())).toBe('token-2');
    expect(google.calls).toHaveLength(2);
  });

  it('concurrent cold requests share a single exchange', async () => {
    const google = fakeTokenEndpoint();
    const source = new GoogleTokenSource({ fetch: google.fetch, now: () => T0 });
    const tokens = await Promise.all([
      source.get(tokenEnv()),
      source.get(tokenEnv()),
      source.get(tokenEnv()),
    ]);
    expect(tokens).toEqual(['token-1', 'token-1', 'token-1']);
    expect(google.calls).toHaveLength(1);
  });

  it('a Google error → 502 UPSTREAM_ERROR and nothing cached; the next call retries', async () => {
    const failing = fakeTokenEndpoint({ status: 400 });
    const source = new GoogleTokenSource({ fetch: failing.fetch, now: () => T0 });
    const err = await source.get(tokenEnv()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      status: 502,
      code: 'UPSTREAM_ERROR',
      details: { service: 'google_oauth', status: 400 },
    });
    expect(await cachedRow()).toBeNull();
    await expect(source.get(tokenEnv())).rejects.toBeInstanceOf(ApiError);
    expect(failing.calls).toHaveLength(2);
  });

  it.each([
    ['missing', null],
    ['not JSON', 'not-json'],
    ['without private key', JSON.stringify({ client_email: 'x@y.iam.gserviceaccount.com' })],
  ])('service account %s → 500 INTERNAL without calling Google', async (_case, value) => {
    const google = fakeTokenEndpoint();
    const source = new GoogleTokenSource({ fetch: google.fetch, now: () => T0 });
    await expect(source.get(tokenEnv(value))).rejects.toMatchObject({ status: 500, code: 'INTERNAL' });
    expect(google.calls).toHaveLength(0);
  });
});
