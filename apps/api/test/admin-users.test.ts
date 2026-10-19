import { env } from 'cloudflare:workers';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN_ID, MEMBER_ID, syncHarness } from './support/sync';
import { insertUser, linkIdentity } from './support/firebase';

/** Fake Identity Toolkit: records every call; `failOn` makes one operation answer an error. */
interface Call {
  op: string;
  body: Record<string, unknown>;
  authorization: string | null;
}
let calls: Call[];
let failOn: Record<string, { status: number; message: string } | 'network'>;
let created = 0;
/** Makes the n-th `disableUser: true` update fail (null = never). */
let failDisableAt: number | null;
let disables = 0;

const fakeFetch: typeof fetch = async (input, init) => {
  const url = new URL(String(input instanceof Request ? input.url : input));
  const op = url.pathname.split('/').at(-1)!;
  calls.push({
    op,
    body: JSON.parse(String(init?.body ?? '{}')),
    authorization: new Headers(init?.headers).get('Authorization'),
  });
  expect(url.origin + url.pathname).toBe(
    `https://identitytoolkit.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/${op}`,
  );
  const body = JSON.parse(String(init?.body ?? '{}'));
  if (body.disableUser === true && ++disables === failDisableAt) {
    return Response.json({ error: { message: 'INTERNAL' } }, { status: 500 });
  }
  const failure = failOn[op];
  if (failure === 'network') throw new TypeError('Network connection lost.');
  if (failure)
    return Response.json(
      { error: { code: failure.status, message: failure.message } },
      { status: failure.status },
    );
  if (op === 'accounts') return Response.json({ localId: `fb-${++created}` });
  return Response.json({});
};
const fakeTokens = { get: async () => 'service-token' };

let h: Awaited<ReturnType<typeof syncHarness>>;

beforeAll(async () => {
  h = await syncHarness({ fetch: fakeFetch, googleTokens: fakeTokens });
});

beforeEach(async () => {
  await h.reset();
  calls = [];
  failOn = {};
  created = 0;
  failDisableAt = null;
  disables = 0;
});

type Body = {
  user?: Record<string, unknown>;
  items?: Array<Record<string, unknown>>;
  error?: { code: string };
};

async function call(method: string, path: string, body?: unknown, as: 'admin' | 'member' = 'admin') {
  const res = await h.app.request(
    path,
    {
      method,
      headers: { Authorization: `Bearer ${h.tokens[as]}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    env as never,
  );
  return { status: res.status, body: res.status === 204 ? ({} as Body) : await res.json<Body>() };
}

const version = async () =>
  Number(await env.DB.prepare(`SELECT value FROM sync_meta WHERE key = 'version'`).first('value'));
const identities = async (userId: string) =>
  (
    await env.DB.prepare(
      'SELECT firebase_uid, provider FROM user_identities WHERE user_id = ?1 ORDER BY firebase_uid',
    )
      .bind(userId)
      .all<{ firebase_uid: string; provider: string }>()
  ).results;

describe('GET /v1/admin/users', () => {
  it('lists the household users with their access methods', async () => {
    const { status, body } = await call('GET', '/v1/admin/users');
    expect(status).toBe(200);
    expect(body.items).toEqual([
      expect.objectContaining({
        id: ADMIN_ID,
        username: 'mau',
        role: 'admin',
        active: true,
        has_password: true,
        google_email: null,
      }),
      expect.objectContaining({
        id: MEMBER_ID,
        username: 'pepe',
        role: 'member',
        active: true,
        has_password: true,
      }),
    ]);
  });

  it('every admin route is for admins only', async () => {
    for (const [method, path] of [
      ['GET', '/v1/admin/users'],
      ['POST', '/v1/admin/users'],
      ['PATCH', `/v1/admin/users/${MEMBER_ID}`],
      ['POST', `/v1/admin/users/${MEMBER_ID}/password`],
    ] as const) {
      const res = await call(method, path, method === 'GET' ? undefined : {}, 'member');
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(res.body.error?.code).toBe('FORBIDDEN');
    }
    expect(calls).toEqual([]);
  });
});

describe('POST /v1/admin/users (02 §5.3)', () => {
  it('with a password: creates the Firebase account with the synthetic e-mail, then the user and its identity', async () => {
    const before = await version();
    const { status, body } = await call('POST', '/v1/admin/users', {
      username: '  Luis ',
      display_name: 'Luis',
      role: 'member',
      password: 'secreta123',
    });
    expect(status).toBe(201);
    expect(body.user).toMatchObject({
      username: 'luis',
      display_name: 'Luis',
      role: 'member',
      active: true,
      has_password: true,
      google_email: null,
    });
    expect(calls).toEqual([
      {
        op: 'accounts',
        body: { email: `luis@${env.SYNTHETIC_EMAIL_DOMAIN}`, password: 'secreta123', displayName: 'Luis' },
        authorization: 'Bearer service-token',
      },
    ]);
    const id = String(body.user!.id);
    expect(await identities(id)).toEqual([{ firebase_uid: 'fb-1', provider: 'password' }]);
    const row = await env.DB.prepare('SELECT * FROM users WHERE id = ?1')
      .bind(id)
      .first<Record<string, unknown>>();
    expect(row).toMatchObject({ version: before + 1 });
    expect(JSON.stringify(row)).not.toContain('secreta123');
  });

  it('with only a Google e-mail: no Firebase call; the account links on its first sign-in', async () => {
    const { status, body } = await call('POST', '/v1/admin/users', {
      username: 'ana',
      display_name: 'Ana',
      role: 'admin',
      google_email: 'Ana.Lopez@Gmail.com',
    });
    expect(status).toBe(201);
    expect(body.user).toMatchObject({
      google_email: 'ana.lopez@gmail.com',
      has_password: false,
      role: 'admin',
    });
    expect(calls).toEqual([]);
  });

  it('rejects before calling Firebase: taken username or e-mail, invalid username, short password, no access method', async () => {
    await insertUser(env.DB, {
      id: '0192a5e9-0000-7000-8000-00000000c0c0',
      username: 'ana',
      google_email: 'ana@gmail.com',
    });
    const cases: Array<[Record<string, unknown>, number, string]> = [
      [{ username: 'MAU', display_name: 'X', role: 'member', password: 'secreta123' }, 409, 'USERNAME_TAKEN'],
      [
        { username: 'luis', display_name: 'X', role: 'member', google_email: 'ANA@gmail.com' },
        409,
        'GOOGLE_EMAIL_TAKEN',
      ],
      [{ username: 'l', display_name: 'X', role: 'member', password: 'secreta123' }, 400, 'USERNAME_INVALID'],
      [
        { username: 'luis!', display_name: 'X', role: 'member', password: 'secreta123' },
        400,
        'USERNAME_INVALID',
      ],
      [{ username: 'luis', display_name: 'X', role: 'member', password: 'corta' }, 400, 'WEAK_PASSWORD'],
      [{ username: 'luis', display_name: 'X', role: 'member' }, 400, 'VALIDATION_ERROR'],
      [
        { username: 'luis', display_name: 'X', role: 'owner', password: 'secreta123' },
        400,
        'VALIDATION_ERROR',
      ],
    ];
    for (const [body, status, code] of cases) {
      const res = await call('POST', '/v1/admin/users', body);
      expect([res.status, res.body.error?.code], JSON.stringify(body)).toEqual([status, code]);
    }
    expect(calls).toEqual([]);
  });

  it('maps Identity Toolkit errors and writes nothing', async () => {
    const attempt = () =>
      call('POST', '/v1/admin/users', {
        username: 'luis',
        display_name: 'Luis',
        role: 'member',
        password: 'secreta123',
      });
    failOn.accounts = { status: 400, message: 'EMAIL_EXISTS' };
    expect(await attempt()).toMatchObject({ status: 409, body: { error: { code: 'USERNAME_TAKEN' } } });
    failOn.accounts = { status: 400, message: 'WEAK_PASSWORD : Password should be at least 6 characters' };
    expect(await attempt()).toMatchObject({ status: 400, body: { error: { code: 'WEAK_PASSWORD' } } });
    failOn.accounts = { status: 503, message: 'UNAVAILABLE' };
    expect(await attempt()).toMatchObject({ status: 502, body: { error: { code: 'UPSTREAM_ERROR' } } });
    failOn.accounts = 'network';
    expect((await attempt()).status).toBe(502);
    expect(await env.DB.prepare(`SELECT count(*) AS n FROM users WHERE username = 'luis'`).first('n')).toBe(
      0,
    );
  });

  it('if D1 fails after creating the Firebase account, the account is deleted (compensation)', async () => {
    await env.DB.prepare(
      `CREATE TRIGGER test_fail_users BEFORE INSERT ON users WHEN NEW.username = 'luis'
       BEGIN SELECT RAISE(ABORT, 'test failure'); END`,
    ).run();
    try {
      const res = await call('POST', '/v1/admin/users', {
        username: 'luis',
        display_name: 'Luis',
        role: 'member',
        password: 'secreta123',
      });
      expect(res.status).toBe(500);
      expect(calls.map((c) => [c.op, c.body.localId])).toEqual([
        ['accounts', undefined],
        ['accounts:delete', 'fb-1'],
      ]);
      expect(
        await env.DB.prepare(`SELECT count(*) AS n FROM user_identities WHERE firebase_uid = 'fb-1'`).first(
          'n',
        ),
      ).toBe(0);
    } finally {
      await env.DB.prepare('DROP TRIGGER test_fail_users').run();
    }
  });

  it('a username race lost in D1 answers USERNAME_TAKEN and still compensates', async () => {
    await env.DB.prepare(
      `CREATE TRIGGER test_race_users BEFORE INSERT ON users WHEN NEW.username = 'luis'
       BEGIN SELECT RAISE(ABORT, 'UNIQUE constraint failed: users.username'); END`,
    ).run();
    try {
      const res = await call('POST', '/v1/admin/users', {
        username: 'luis',
        display_name: 'Luis',
        role: 'member',
        password: 'secreta123',
      });
      expect(res).toMatchObject({ status: 409, body: { error: { code: 'USERNAME_TAKEN' } } });
      expect(calls.map((c) => c.op)).toEqual(['accounts', 'accounts:delete']);
    } finally {
      await env.DB.prepare('DROP TRIGGER test_race_users').run();
    }
  });
});

describe('PATCH /v1/admin/users/:id', () => {
  it('edits name and role with a new version', async () => {
    const before = await version();
    const { status, body } = await call('PATCH', `/v1/admin/users/${MEMBER_ID}`, {
      display_name: 'José',
      role: 'admin',
    });
    expect(status).toBe(200);
    expect(body.user).toMatchObject({ display_name: 'José', role: 'admin' });
    expect(
      await env.DB.prepare('SELECT version FROM users WHERE id = ?1').bind(MEMBER_ID).first('version'),
    ).toBe(before + 1);
    expect(calls).toEqual([]);
  });

  it('never leaves the household without an active admin (LAST_ADMIN)', async () => {
    for (const patch of [{ role: 'member' }, { active: false }]) {
      const res = await call('PATCH', `/v1/admin/users/${ADMIN_ID}`, patch);
      expect([res.status, res.body.error?.code]).toEqual([409, 'LAST_ADMIN']);
    }
    await call('PATCH', `/v1/admin/users/${MEMBER_ID}`, { role: 'admin' });
    expect((await call('PATCH', `/v1/admin/users/${ADMIN_ID}`, { role: 'member' })).status).toBe(200);
  });

  it('changing or removing the Google e-mail drops the google.com identities, not the password one', async () => {
    await linkIdentity(env.DB, 'google-uid-old', MEMBER_ID, 'google.com');
    const changed = await call('PATCH', `/v1/admin/users/${MEMBER_ID}`, { google_email: 'pepe@gmail.com' });
    expect(changed.body.user).toMatchObject({ google_email: 'pepe@gmail.com' });
    expect(await identities(MEMBER_ID)).toEqual([{ firebase_uid: 'uid-member', provider: 'password' }]);

    await linkIdentity(env.DB, 'google-uid-new', MEMBER_ID, 'google.com');
    // Same e-mail with other capitals is not a change.
    await call('PATCH', `/v1/admin/users/${MEMBER_ID}`, { google_email: 'PEPE@gmail.com' });
    expect(await identities(MEMBER_ID)).toHaveLength(2);
    await call('PATCH', `/v1/admin/users/${MEMBER_ID}`, { google_email: null });
    expect(await identities(MEMBER_ID)).toEqual([{ firebase_uid: 'uid-member', provider: 'password' }]);
  });

  it('GOOGLE_EMAIL_TAKEN when another user has it', async () => {
    await call('PATCH', `/v1/admin/users/${ADMIN_ID}`, { google_email: 'mau@gmail.com' });
    const res = await call('PATCH', `/v1/admin/users/${MEMBER_ID}`, { google_email: 'Mau@Gmail.com' });
    expect([res.status, res.body.error?.code]).toEqual([409, 'GOOGLE_EMAIL_TAKEN']);
  });

  it('deactivating disables every Firebase account of the user; reactivating enables them', async () => {
    await linkIdentity(env.DB, 'google-uid', MEMBER_ID, 'google.com');
    const off = await call('PATCH', `/v1/admin/users/${MEMBER_ID}`, { active: false });
    expect(off.body.user).toMatchObject({ active: false });
    expect(calls.map((c) => [c.op, c.body])).toEqual([
      ['accounts:update', { localId: 'google-uid', disableUser: true }],
      ['accounts:update', { localId: 'uid-member', disableUser: true }],
    ]);
    calls = [];
    await call('PATCH', `/v1/admin/users/${MEMBER_ID}`, { active: true });
    expect(calls.map((c) => c.body.disableUser)).toEqual([false, false]);
  });

  it('if Firebase fails while deactivating, the accounts already disabled are enabled again and D1 is untouched', async () => {
    await linkIdentity(env.DB, 'google-uid', MEMBER_ID, 'google.com');
    failDisableAt = 2;
    const res = await call('PATCH', `/v1/admin/users/${MEMBER_ID}`, { active: false });
    expect(res.status).toBe(502);
    // The second account fails; the first one is enabled again.
    expect(calls.map((c) => [c.body.localId, c.body.disableUser])).toEqual([
      ['google-uid', true],
      ['uid-member', true],
      ['google-uid', false],
    ]);
    expect(
      await env.DB.prepare('SELECT active FROM users WHERE id = ?1').bind(MEMBER_ID).first('active'),
    ).toBe(1);
  });

  it('unknown user → 404; nothing to change → 400', async () => {
    expect(
      (await call('PATCH', '/v1/admin/users/0192a5e9-0000-7000-8000-0000000000ff', { display_name: 'X' }))
        .status,
    ).toBe(404);
    expect((await call('PATCH', `/v1/admin/users/${MEMBER_ID}`, {})).status).toBe(400);
  });
});

describe('POST /v1/admin/users/:id/password', () => {
  it('updates the password of the linked Firebase account', async () => {
    const res = await call('POST', `/v1/admin/users/${MEMBER_ID}/password`, { password: 'nueva-clave' });
    expect(res.status).toBe(204);
    expect(calls.map((c) => [c.op, c.body])).toEqual([
      ['accounts:update', { localId: 'uid-member', password: 'nueva-clave' }],
    ]);
  });

  it('a Google-only user gets a password account linked (disabled if the user is inactive)', async () => {
    const id = '0192a5e9-0000-7000-8000-00000000d0d0';
    await insertUser(env.DB, { id, username: 'ana', google_email: 'ana@gmail.com', active: 0 });
    const res = await call('POST', `/v1/admin/users/${id}/password`, { password: 'nueva-clave' });
    expect(res.status).toBe(204);
    expect(calls.map((c) => [c.op, c.body])).toEqual([
      [
        'accounts',
        { email: `ana@${env.SYNTHETIC_EMAIL_DOMAIN}`, password: 'nueva-clave', displayName: 'ana' },
      ],
      ['accounts:update', { localId: 'fb-1', disableUser: true }],
    ]);
    expect(await identities(id)).toEqual([{ firebase_uid: 'fb-1', provider: 'password' }]);
  });

  it('short password → 400 WEAK_PASSWORD; unknown user → 404', async () => {
    const weak = await call('POST', `/v1/admin/users/${MEMBER_ID}/password`, { password: '1234567' });
    expect([weak.status, weak.body.error?.code]).toEqual([400, 'WEAK_PASSWORD']);
    expect(
      (
        await call('POST', '/v1/admin/users/0192a5e9-0000-7000-8000-0000000000ff/password', {
          password: 'nueva-clave',
        })
      ).status,
    ).toBe(404);
    expect(calls).toEqual([]);
  });
});
