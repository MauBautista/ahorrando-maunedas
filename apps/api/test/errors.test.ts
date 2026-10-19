import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { ApiError } from '../src/errors';

// Test-only routes; the production app never mounts them.
const app = createApp((a) => {
  a.get('/v1/__test/conflict', () => {
    throw new ApiError(409, 'MERGE_INVALID', { reason: 'same_id' });
  });
  a.get('/v1/__test/custom-message', () => {
    throw new ApiError(502, 'UPSTREAM_ERROR', { service: 'openrouter' }, 'OpenRouter no respondió.');
  });
  a.get('/v1/__test/crash', () => {
    throw new Error('boom: secret detail that must not leak');
  });
});

const call = (path: string, headers: Record<string, string> = {}) =>
  app.request(path, { headers }, env as never);

describe('error format (03 §1.1)', () => {
  it('renders an ApiError with code, Spanish message, details and request id', async () => {
    const res = await call('/v1/__test/conflict', { 'X-Request-Id': 'req-0192-error' });
    expect(res.status).toBe(409);
    expect(res.headers.get('X-Request-Id')).toBe('req-0192-error');
    expect(await res.json()).toEqual({
      error: {
        code: 'MERGE_INVALID',
        message: 'No se pueden fusionar esos registros.',
        details: { reason: 'same_id' },
        request_id: 'req-0192-error',
      },
    });
  });

  it('keeps a custom message when one is given', async () => {
    const res = await call('/v1/__test/custom-message');
    expect(res.status).toBe(502);
    const body = await res.json<{ error: { code: string; message: string } }>();
    expect(body.error).toMatchObject({ code: 'UPSTREAM_ERROR', message: 'OpenRouter no respondió.' });
  });

  it('turns an unexpected error into 500 INTERNAL without leaking details', async () => {
    const res = await call('/v1/__test/crash', { 'X-Request-Id': 'req-0192-crash' });
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({
      error: { code: 'INTERNAL', message: 'Ocurrió un error inesperado.', request_id: 'req-0192-crash' },
    });
    expect(text).not.toContain('boom');
    expect(text).not.toContain('at ');
  });

  it('omits details when there are none', async () => {
    const res = await call('/v1/nothing-here');
    const body = await res.json<{ error: Record<string, unknown> }>();
    expect(body.error).not.toHaveProperty('details');
  });
});
