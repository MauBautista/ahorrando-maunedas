import { describe, expect, it } from 'vitest';
import { FakeAuth } from '../test/fakes';
import { ApiError, CLIENT_SCHEMA, createApi } from './api';

function server(answers: Array<Response | Error>) {
  const requests: Array<{ path: string; init: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    requests.push({ path: String(input), init });
    const next = answers.shift()!;
    if (next instanceof Error) throw next;
    return next;
  };
  return { fetchImpl, requests };
}

/** The error a request ends with; a request that succeeds fails the test. */
async function failure(request: Promise<unknown>): Promise<ApiError> {
  try {
    await request;
  } catch (e) {
    if (e instanceof ApiError) return e;
    throw e;
  }
  throw new Error('se esperaba un error');
}

const error = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message } }, { status });

describe('createApi (06 §4)', () => {
  it('sends the token and the client headers, and parses the answer', async () => {
    const { fetchImpl, requests } = server([Response.json({ ok: true })]);
    const api = createApi(new FakeAuth({ uid: 'a' }), fetchImpl);
    expect(await api.post('/v1/x', { n: 1 })).toEqual({ ok: true });
    const headers = new Headers(requests[0]!.init.headers);
    expect(requests[0]!.path).toBe('/v1/x');
    expect([
      headers.get('Authorization'),
      headers.get('X-Client-Schema'),
      headers.get('X-Client-Version'),
    ]).toEqual(['Bearer token-a', String(CLIENT_SCHEMA), 'test']);
    expect(requests[0]!.init.body).toBe('{"n":1}');
  });

  it('retries a 401 once with a fresh token', async () => {
    const auth = new FakeAuth({ uid: 'a' });
    const { fetchImpl, requests } = server([
      error(401, 'INVALID_TOKEN', 'Tu sesión expiró.'),
      Response.json({ ok: 1 }),
      error(401, 'INVALID_TOKEN', 'x'),
      error(401, 'INVALID_TOKEN', 'Tu sesión expiró.'),
    ]);
    const api = createApi(auth, fetchImpl);
    expect(await api.get('/v1/me')).toEqual({ ok: 1 });
    expect(new Headers(requests[1]!.init.headers).get('Authorization')).toBe('Bearer token-a-fresh');
    const second = await failure(api.get('/v1/me'));
    expect([second.status, second.code, requests.length, auth.forcedTokens]).toEqual([
      401,
      'INVALID_TOKEN',
      4,
      2,
    ]);
  });

  it('ends the session of a removed or disabled account and types every error', async () => {
    const auth = new FakeAuth({ uid: 'a' });
    const { fetchImpl } = server([
      error(403, 'USER_DISABLED', 'Tu acceso está desactivado. Habla con el administrador.'),
      new TypeError('Failed to fetch'),
      new Response(null, { status: 204 }),
    ]);
    const api = createApi(auth, fetchImpl);
    const disabled = await failure(api.get('/v1/me'));
    expect(disabled).toBeInstanceOf(ApiError);
    expect([disabled.status, disabled.code, disabled.message, auth.signOuts]).toEqual([
      403,
      'USER_DISABLED',
      'Tu acceso está desactivado. Habla con el administrador.',
      1,
    ]);
    const offline = await failure(api.get('/v1/me'));
    expect([offline.status, offline.code]).toEqual([0, 'NETWORK']);
    expect(await api.del('/v1/y')).toBeUndefined();
  });
});
