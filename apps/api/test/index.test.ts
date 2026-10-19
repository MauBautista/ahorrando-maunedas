import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { API_VERSION } from '../src/version';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const call = (path: string, init?: RequestInit) =>
  exports.default.fetch(new Request(`https://maunedas.test${path}`, init));

describe('GET /v1/health', () => {
  it('answers without auth or client headers', async () => {
    const res = await call('/v1/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, version: API_VERSION, schema_version: 1 });
  });
});

describe('X-Request-Id', () => {
  it('is generated when missing', async () => {
    const res = await call('/v1/health');
    expect(res.headers.get('X-Request-Id')).toMatch(UUID);
  });

  it('echoes a well-formed incoming id', async () => {
    const res = await call('/v1/health', { headers: { 'X-Request-Id': 'android-0192abcd-01' } });
    expect(res.headers.get('X-Request-Id')).toBe('android-0192abcd-01');
  });

  it('replaces a malformed incoming id', async () => {
    const res = await call('/v1/health', { headers: { 'X-Request-Id': 'bad id <script>' } });
    expect(res.headers.get('X-Request-Id')).toMatch(UUID);
  });
});

describe('unknown routes', () => {
  it('return NOT_FOUND in the error format with the request id', async () => {
    const res = await call('/v1/does-not-exist');
    expect(res.status).toBe(404);
    const body = await res.json<{ error: Record<string, unknown> }>();
    expect(body).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'No se encontró lo que buscas.',
        request_id: res.headers.get('X-Request-Id'),
      },
    });
  });
});

describe('X-Client-Schema', () => {
  it('is optional outside /v1/sync/*', async () => {
    expect((await call('/v1/health')).status).toBe(200);
  });

  it('accepts the minimum schema', async () => {
    expect((await call('/v1/health', { headers: { 'X-Client-Schema': '1' } })).status).toBe(200);
  });

  it('answers 426 UPGRADE_REQUIRED below MIN_CLIENT_SCHEMA', async () => {
    const res = await call('/v1/health', { headers: { 'X-Client-Schema': '0' } });
    expect(res.status).toBe(426);
    const body = await res.json<{ error: { code: string; details: unknown } }>();
    expect(body.error.code).toBe('UPGRADE_REQUIRED');
    expect(body.error.details).toEqual({ min_client_schema: 1 });
  });

  it('answers 400 VALIDATION_ERROR when it is not an integer', async () => {
    const res = await call('/v1/health', { headers: { 'X-Client-Schema': 'v2' } });
    expect(res.status).toBe(400);
    expect((await res.json<{ error: { code: string } }>()).error.code).toBe('VALIDATION_ERROR');
  });

  it('is required on /v1/sync/*', async () => {
    const res = await call('/v1/sync/push', { method: 'POST', body: '{}' });
    expect(res.status).toBe(400);
    const body = await res.json<{ error: { code: string; details: unknown } }>();
    expect(body.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { header: 'X-Client-Schema', reason: 'required' },
    });
  });

  it('lets /v1/sync/* through when present (routes arrive with T-031)', async () => {
    const res = await call('/v1/sync/push', {
      method: 'POST',
      body: '{}',
      headers: { 'X-Client-Schema': '1' },
    });
    expect(res.status).toBe(404);
  });
});
