import { env } from 'cloudflare:workers';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { clearUsers, insertUser } from './support/firebase';
import { syncHarness } from './support/sync';

const TOKEN = 'test-bootstrap-token';
let calls: Array<{ op: string; body: Record<string, unknown> }>;
/** Simulates another bootstrap that wins while Firebase creates the account. */
let raceOnCreate = false;

const fakeFetch: typeof fetch = async (input, init) => {
  const op = new URL(String(input instanceof Request ? input.url : input)).pathname.split('/').at(-1)!;
  calls.push({ op, body: JSON.parse(String(init?.body ?? '{}')) });
  if (op === 'accounts') {
    if (raceOnCreate)
      await insertUser(env.DB, {
        id: '0192a5e9-0000-7000-8000-00000000e0e0',
        username: 'otro',
        role: 'admin',
      });
    return Response.json({ localId: 'fb-admin' });
  }
  return Response.json({});
};

let h: Awaited<ReturnType<typeof syncHarness>>;

beforeAll(async () => {
  h = await syncHarness({ fetch: fakeFetch, googleTokens: { get: async () => 'service-token' } });
});

beforeEach(async () => {
  await h.reset();
  await clearUsers(env.DB);
  calls = [];
  raceOnCreate = false;
});

const FIRST = {
  username: 'mau',
  display_name: 'Mauricio',
  password: 'secreta123',
  google_email: 'Mau@Gmail.com',
};

async function bootstrap(
  body: unknown,
  headers: Record<string, string> = { 'X-Bootstrap-Token': TOKEN },
  secret: string | null = TOKEN,
) {
  const res = await h.app.request(
    '/v1/bootstrap',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    },
    // `null` = the secret is not configured at all.
    { ...env, BOOTSTRAP_TOKEN: secret ?? undefined } as never,
  );
  return {
    status: res.status,
    body: await res.json<{ user?: Record<string, unknown>; error?: { code: string } }>(),
  };
}

describe('POST /v1/bootstrap (02 §5.4, §9)', () => {
  it('without the secret configured, or with a wrong or missing token → 401, nothing touched', async () => {
    for (const [headers, secret] of [
      [{ 'X-Bootstrap-Token': TOKEN }, null],
      [{ 'X-Bootstrap-Token': TOKEN }, ''],
      [{ 'X-Bootstrap-Token': 'otro-token' }, TOKEN],
      [{}, TOKEN],
      [{ 'X-Bootstrap-Token': '' }, ''],
    ] as const) {
      const res = await bootstrap(FIRST, headers, secret);
      expect([res.status, res.body.error?.code]).toEqual([401, 'UNAUTHENTICATED']);
    }
    expect(calls).toEqual([]);
    expect(await env.DB.prepare('SELECT count(*) AS n FROM users').first('n')).toBe(0);
  });

  it('creates the first admin with password and Google e-mail', async () => {
    const { status, body } = await bootstrap(FIRST);
    expect(status).toBe(201);
    expect(body.user).toMatchObject({
      username: 'mau',
      display_name: 'Mauricio',
      role: 'admin',
      active: true,
      google_email: 'mau@gmail.com',
      has_password: true,
    });
    expect(calls).toEqual([
      {
        op: 'accounts',
        body: { email: `mau@${env.SYNTHETIC_EMAIL_DOMAIN}`, password: 'secreta123', displayName: 'Mauricio' },
      },
    ]);
  });

  it('a role in the body is ignored: the first user is always an admin', async () => {
    const { body } = await bootstrap({ ...FIRST, role: 'member' });
    expect(body.user).toMatchObject({ role: 'admin' });
  });

  it('once there is a user → 410 ALREADY_BOOTSTRAPPED, without calling Firebase', async () => {
    await bootstrap(FIRST);
    calls = [];
    const again = await bootstrap({ ...FIRST, username: 'otro' });
    expect([again.status, again.body.error?.code]).toEqual([410, 'ALREADY_BOOTSTRAPPED']);
    expect(calls).toEqual([]);
  });

  it('if another bootstrap wins meanwhile, answers 410 and deletes the Firebase account it created', async () => {
    raceOnCreate = true;
    const res = await bootstrap(FIRST);
    expect([res.status, res.body.error?.code]).toEqual([410, 'ALREADY_BOOTSTRAPPED']);
    expect(calls.map((c) => [c.op, c.body.localId])).toEqual([
      ['accounts', undefined],
      ['accounts:delete', 'fb-admin'],
    ]);
    const { results } = await env.DB.prepare('SELECT username FROM users').all();
    expect(results).toEqual([{ username: 'otro' }]);
    expect(await env.DB.prepare('SELECT count(*) AS n FROM user_identities').first('n')).toBe(0);
  });

  it('validates the body after the token', async () => {
    expect((await bootstrap({ username: 'mau', display_name: 'Mauricio' })).status).toBe(400);
    expect((await bootstrap({ ...FIRST, password: 'corta' })).body.error?.code).toBe('WEAK_PASSWORD');
    expect((await bootstrap({ ...FIRST, username: 'x' })).body.error?.code).toBe('USERNAME_INVALID');
    expect(calls).toEqual([]);
  });
});
