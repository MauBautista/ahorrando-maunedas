import { env } from 'cloudflare:workers';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { clearUsers, createTestIssuer, insertUser, linkIdentity } from './support/firebase';

const PHONE_A = '0192a5e0-7c3e-7b2a-9f1d-3c4b5a6d7e8f';
const PHONE_B = '0192a5e1-1a2b-7c3d-8e4f-5a6b7c8d9e0f';

let issuer: Awaited<ReturnType<typeof createTestIssuer>>;
let app: ReturnType<typeof createApp>;
let mau: string;
let pepe: string;

beforeAll(async () => {
  issuer = await createTestIssuer(env.FIREBASE_PROJECT_ID);
  app = createApp({ firebaseKeys: issuer.keys });
  mau = await issuer.token({ sub: 'uid-mau' });
  pepe = await issuer.token({ sub: 'uid-pepe' });
});

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM devices').run();
  await clearUsers(env.DB);
  await insertUser(env.DB, { id: 'u-mau', username: 'mau', role: 'admin' });
  await insertUser(env.DB, { id: 'u-pepe', username: 'pepe' });
  await linkIdentity(env.DB, 'uid-mau', 'u-mau');
  await linkIdentity(env.DB, 'uid-pepe', 'u-pepe');
});

const register = (token: string | null, body: unknown) =>
  app.request(
    '/v1/devices',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    },
    env as never,
  );

const remove = (token: string, id: string) =>
  app.request(
    `/v1/devices/${id}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
    env as never,
  );

const device = (id: string) =>
  env.DB.prepare(
    'SELECT user_id, platform, fcm_token, app_version, last_seen_at, created_at FROM devices WHERE id = ?1',
  )
    .bind(id)
    .first<{
      user_id: string;
      platform: string;
      fcm_token: string | null;
      app_version: string;
      last_seen_at: number;
      created_at: number;
    }>();

const android = (id: string, fcm: string | null, version = '0.1.0') => ({
  device_id: id,
  platform: 'android',
  fcm_token: fcm,
  app_version: version,
});

describe('POST /v1/devices (03 §5)', () => {
  it('registers a new device → 204', async () => {
    const res = await register(mau, android(PHONE_A, 'fcm-token-a'));
    expect(res.status).toBe(204);
    const row = await device(PHONE_A);
    expect(row).toMatchObject({
      user_id: 'u-mau',
      platform: 'android',
      fcm_token: 'fcm-token-a',
      app_version: '0.1.0',
    });
    expect(row?.last_seen_at).toBe(row?.created_at);
  });

  it('upserts by device_id: updates token, version and last seen, keeps created_at', async () => {
    await register(mau, android(PHONE_A, 'fcm-token-a'));
    const before = await device(PHONE_A);
    await new Promise((r) => setTimeout(r, 5));
    expect((await register(mau, android(PHONE_A, 'fcm-token-a2', '0.2.0'))).status).toBe(204);
    const after = await device(PHONE_A);
    expect(after).toMatchObject({
      fcm_token: 'fcm-token-a2',
      app_version: '0.2.0',
      created_at: before?.created_at,
    });
    expect(after!.last_seen_at).toBeGreaterThan(before!.last_seen_at);
    const { n } = (await env.DB.prepare('SELECT count(*) AS n FROM devices').first<{ n: number }>())!;
    expect(n).toBe(1);
  });

  it('a token registered by another device is cleared from the old one', async () => {
    await register(pepe, android(PHONE_B, 'fcm-shared'));
    await register(mau, android(PHONE_A, 'fcm-shared'));
    expect((await device(PHONE_B))?.fcm_token).toBeNull();
    expect((await device(PHONE_A))?.fcm_token).toBe('fcm-shared');
  });

  it('a phone that changes hands moves to the user who registers it now', async () => {
    await register(pepe, android(PHONE_A, 'fcm-a'));
    await register(mau, android(PHONE_A, 'fcm-a'));
    expect((await device(PHONE_A))?.user_id).toBe('u-mau');
  });

  it('accepts a web device without FCM token', async () => {
    const res = await register(mau, {
      device_id: PHONE_B,
      platform: 'web',
      fcm_token: null,
      app_version: 'web-0.1.0',
    });
    expect(res.status).toBe(204);
    expect(await device(PHONE_B)).toMatchObject({ platform: 'web', fcm_token: null });
  });

  it('a null token never clears other devices', async () => {
    await register(pepe, android(PHONE_B, 'fcm-b'));
    await register(mau, android(PHONE_A, null));
    expect((await device(PHONE_B))?.fcm_token).toBe('fcm-b');
  });

  it.each([
    ['device_id is not a UUID', { ...android(PHONE_A, 'x'), device_id: 'phone-1' }, 'device_id'],
    ['unknown platform', { ...android(PHONE_A, 'x'), platform: 'ios' }, 'platform'],
    ['missing app_version', { device_id: PHONE_A, platform: 'android', fcm_token: 'x' }, 'app_version'],
    ['unexpected field', { ...android(PHONE_A, 'x'), user_id: 'u-pepe' }, ''],
  ])('%s → 400 VALIDATION_ERROR with issues', async (_case, body, path) => {
    const res = await register(mau, body);
    expect(res.status).toBe(400);
    const { error } = await res.json<{
      error: { code: string; details: { issues: Array<{ path: string[] }> } };
    }>();
    expect(error.code).toBe('VALIDATION_ERROR');
    if (path) expect(error.details.issues.map((i) => i.path.join('.'))).toContain(path);
    expect(await device(PHONE_A)).toBeNull();
  });

  it('invalid JSON → 400 VALIDATION_ERROR', async () => {
    const res = await register(mau, '{not json');
    expect(res.status).toBe(400);
    expect((await res.json<{ error: { code: string } }>()).error.code).toBe('VALIDATION_ERROR');
  });

  it('requires a signed-in user', async () => {
    expect((await register(null, android(PHONE_A, 'x'))).status).toBe(401);
  });
});

describe('DELETE /v1/devices/:deviceId (03 §5)', () => {
  it('the owner deletes the device → 204', async () => {
    await register(mau, android(PHONE_A, 'fcm-a'));
    expect((await remove(mau, PHONE_A)).status).toBe(204);
    expect(await device(PHONE_A)).toBeNull();
  });

  it("someone else's device → 403 FORBIDDEN and the row stays", async () => {
    await register(pepe, android(PHONE_B, 'fcm-b'));
    const res = await remove(mau, PHONE_B);
    expect(res.status).toBe(403);
    expect((await res.json<{ error: { code: string } }>()).error.code).toBe('FORBIDDEN');
    expect(await device(PHONE_B)).not.toBeNull();
  });

  it('an unknown device → 204 (signing out twice is fine)', async () => {
    expect((await remove(mau, PHONE_A)).status).toBe(204);
  });

  it('a malformed id → 400 VALIDATION_ERROR', async () => {
    expect((await remove(mau, 'not-a-uuid')).status).toBe(400);
  });
});
