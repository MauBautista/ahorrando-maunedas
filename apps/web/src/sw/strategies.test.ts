import { describe, expect, it } from 'vitest';
import { DATA_CACHE_NAMES, STORED_AT_HEADER } from '../lib/online';
import {
  activate,
  API_CACHE,
  DATA_CACHES,
  type Caches,
  type Deps,
  IMAGE_CACHE,
  install,
  respond,
  routeOf,
  SHELL_PREFIX,
  STORED_AT,
} from './strategies';

const ORIGIN = 'https://maunedas.test';
const SHELL = `${SHELL_PREFIX}b2`;

/** Cache Storage in memory: responses by URL (or path), as the browser keys them. */
function fakeCaches(initial: Record<string, Record<string, string>> = {}) {
  const store = new Map<string, Map<string, Response>>();
  for (const [name, entries] of Object.entries(initial)) {
    store.set(name, new Map(Object.entries(entries).map(([k, v]) => [k, new Response(v)])));
  }
  const key = (r: Request | string) => (typeof r === 'string' ? r : r.url);
  const caches: Caches = {
    open: async (name) => {
      const entries = store.get(name) ?? new Map<string, Response>();
      store.set(name, entries);
      return {
        match: async (r) => entries.get(key(r))?.clone(),
        put: async (r, response) => void entries.set(key(r), response),
        addAll: async (urls) => {
          for (const url of urls) entries.set(url, new Response(`archivo ${url}`));
        },
      };
    },
    keys: async () => [...store.keys()],
    delete: async (name) => store.delete(name),
  };
  return { caches, store };
}

/** A network that answers [answer] or, when null, is down; it records what it was asked. */
function deps(
  caches: Caches,
  answer: ((r: Request) => Response) | null = () => new Response('red'),
  now = 7,
) {
  const asked: string[] = [];
  const d: Deps = {
    caches,
    origin: ORIGIN,
    shell: SHELL,
    now: () => now,
    fetch: async (r) => {
      asked.push(r.url);
      if (!answer) throw new TypeError('Failed to fetch');
      return answer(r);
    },
  };
  return { d, asked };
}

const get = (path: string, init: RequestInit = {}) => new Request(`${ORIGIN}${path}`, init);
/** jsdom's Request has no navigate mode: a navigation is built with its mode set. */
const navigation = (path: string) => Object.defineProperty(get(path), 'mode', { value: 'navigate' });

describe('the service worker (T-310)', () => {
  it('shares its names with the page, which keeps its own copy so sw.js imports nothing', () => {
    expect([STORED_AT, DATA_CACHES]).toEqual([STORED_AT_HEADER, DATA_CACHE_NAMES]);
  });

  it('answers only the GETs of its origin, each by its kind', () => {
    const cases: Array<[Request, string]> = [
      [navigation('/compras/123'), 'navigate'],
      [get('/assets/index-abc.js'), 'asset'],
      [get('/icons/icon-192.png'), 'asset'],
      [get('/manifest.webmanifest'), 'asset'],
      [get('/v1/images/i1/blobs/r1.webp?exp=1&sig=a'), 'image'],
      [get('/v1/products?q=leche'), 'api'],
      [get('/v1/me'), 'api'],
      [get('/v1/ai/image-edit'), 'network'],
      [get('/v1/images/i1/edit'), 'network'],
      [get('/v1/sync/push', { method: 'POST', body: '{}' }), 'network'],
      [get('/v1/images/i1/blobs/original.jpg', { method: 'PUT', body: 'x' }), 'network'],
      [new Request('https://identitytoolkit.googleapis.com/v1/token'), 'network'],
      [get('/sw.js'), 'network'],
    ];
    for (const [request, route] of cases)
      expect([request.url, routeOf(request, ORIGIN)]).toEqual([request.url, route]);
  });

  it('keeps the whole build at install and drops older builds at activate', async () => {
    const { caches, store } = fakeCaches({
      [`${SHELL_PREFIX}b1`]: { '/': 'viejo' },
      [API_CACHE]: { x: 'datos' },
      [IMAGE_CACHE]: {},
      otra: {},
    });
    const { d } = deps(caches);
    await install(d, ['/', '/assets/a.js']);
    await activate(d);
    expect([...store.keys()].sort()).toEqual([API_CACHE, IMAGE_CACHE, 'otra', SHELL].sort());
    expect([...store.get(SHELL)!.keys()]).toEqual(['/', '/assets/a.js']);
  });

  it('serves the build from its cache, and the page from the network or, without it, the build', async () => {
    const { caches } = fakeCaches({ [SHELL]: { [`${ORIGIN}/assets/a.js`]: 'guardado', '/': 'la app' } });
    const online = deps(caches);
    expect(await (await respond(online.d, get('/assets/a.js')))!.text()).toBe('guardado');
    expect(await (await respond(online.d, get('/assets/b.js')))!.text()).toBe('red');
    expect(await (await respond(online.d, navigation('/catalogo')))!.text()).toBe('red');
    const offline = deps(caches, null);
    expect(await (await respond(offline.d, navigation('/productos/p1')))!.text()).toBe('la app');
    await expect(respond(deps(fakeCaches().caches, null).d, navigation('/'))).rejects.toThrow('sin conexión');
    expect(await respond(online.d, get('/v1/sync/push', { method: 'POST', body: '{}' }))).toBeNull();
  });

  it('keeps photos by their path, whatever the signature', async () => {
    const { caches, store } = fakeCaches();
    const { d, asked } = deps(caches, (r) =>
      r.url.includes('nope') ? new Response('no', { status: 404 }) : new Response('foto'),
    );
    expect(await (await respond(d, get('/v1/images/i1/blobs/r1.webp?exp=1&sig=a')))!.text()).toBe('foto');
    expect(await (await respond(d, get('/v1/images/i1/blobs/r1.webp?exp=2&sig=b')))!.text()).toBe('foto');
    expect(asked).toHaveLength(1);
    expect([...store.get(IMAGE_CACHE)!.keys()]).toEqual(['/v1/images/i1/blobs/r1.webp']);
    expect((await respond(d, get('/v1/images/nope/blobs/r.webp')))!.status).toBe(404);
    expect(store.get(IMAGE_CACHE)!.size).toBe(1);
  });

  it('reads the API from the network first and, without it, what it answered well before, marked with when', async () => {
    const { caches, store } = fakeCaches();
    let status = 200;
    const online = deps(caches, () => Response.json({ items: [1] }, { status }), 1_000);
    const fresh = (await respond(online.d, get('/v1/products?q=leche')))!;
    expect([fresh.headers.get(STORED_AT), await fresh.json()]).toEqual([null, { items: [1] }]);
    // An error is not kept over what was good.
    status = 500;
    expect((await respond(online.d, get('/v1/products?q=leche')))!.status).toBe(500);

    const offline = deps(caches, null);
    const kept = (await respond(offline.d, get('/v1/products?q=leche')))!;
    expect([kept.status, kept.headers.get(STORED_AT), await kept.json()]).toEqual([
      200,
      '1000',
      { items: [1] },
    ]);
    expect([...store.get(API_CACHE)!.keys()]).toEqual([`${ORIGIN}/v1/products?q=leche`]);
    // Another query was never read: without network there is nothing to show.
    await expect(respond(offline.d, get('/v1/products?q=pan'))).rejects.toThrow('Failed to fetch');
  });
});
