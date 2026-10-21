import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';

interface Seen {
  url: string;
  method: string;
  redirect: RequestInit['redirect'];
  headers: Headers;
  body: string | null;
}
let seen: Seen[];
let reply: () => Response | Promise<Response>;

const app = createApp({
  fetch: async (input, init) => {
    seen.push({
      url: String(input),
      method: init?.method ?? 'GET',
      redirect: init?.redirect,
      headers: new Headers(init?.headers),
      body: init?.body ? await new Response(init.body).text() : null,
    });
    return reply();
  },
});

beforeEach(() => {
  seen = [];
  reply = () =>
    new Response('<html>firebase auth handler</html>', { headers: { 'Content-Type': 'text/html' } });
});

const upstream = (path: string) => `https://${env.FIREBASE_PROJECT_ID}.firebaseapp.com${path}`;

describe('auth proxy /__/auth/* and /__/firebase/* (02 §5.5)', () => {
  it('forwards the handler with its query to <project>.firebaseapp.com and returns the page as is', async () => {
    const res = await app.request('/__/auth/handler?apiKey=k&authType=signInViaPopup', {}, env as never);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/html');
    expect(await res.text()).toBe('<html>firebase auth handler</html>');
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      url: upstream('/__/auth/handler?apiKey=k&authType=signInViaPopup'),
      method: 'GET',
      redirect: 'manual',
    });
  });

  it('also proxies /__/firebase/* (init.json)', async () => {
    reply = () => Response.json({ projectId: env.FIREBASE_PROJECT_ID });
    const res = await app.request('/__/firebase/init.json', {}, env as never);
    expect(await res.json()).toEqual({ projectId: env.FIREBASE_PROJECT_ID });
    expect(seen[0]!.url).toBe(upstream('/__/firebase/init.json'));
  });

  it('passes redirects to the browser without following them', async () => {
    reply = () =>
      new Response(null, {
        status: 302,
        headers: { Location: 'https://accounts.google.com/o/oauth2/auth?x=1' },
      });
    const res = await app.request('/__/auth/handler', {}, env as never);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('https://accounts.google.com/o/oauth2/auth?x=1');
  });

  it('keeps method, body and headers, but never sends our bearer token upstream', async () => {
    await app.request(
      '/__/auth/handler',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: 'Bearer secret',
          'Accept-Language': 'es-MX',
        },
        body: 'a=1&b=2',
      },
      env as never,
    );
    expect(seen[0]).toMatchObject({ method: 'POST', body: 'a=1&b=2' });
    expect(seen[0]!.headers.get('Authorization')).toBeNull();
    expect(seen[0]!.headers.get('Accept-Language')).toBe('es-MX');
  });

  it('an unreachable Firebase Hosting → 502 UPSTREAM_ERROR', async () => {
    reply = () => {
      throw new TypeError('Network connection lost.');
    };
    const res = await app.request('/__/auth/iframe', {}, env as never);
    expect(res.status).toBe(502);
    expect((await res.json<{ error: { code: string; details: unknown } }>()).error).toMatchObject({
      code: 'UPSTREAM_ERROR',
      details: { service: 'firebase_hosting' },
    });
  });

  it('other /__/ paths are not proxied', async () => {
    expect((await app.request('/__/other', {}, env as never)).status).toBe(404);
    expect(seen).toEqual([]);
  });
});
