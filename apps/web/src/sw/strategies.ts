// The service worker's decisions (T-310, 06 §9), apart from the worker itself so they can be tested: which cache
// answers each request and when the network is tried first.

/** The app's own files of one build; a new build is a new cache and the old one is dropped. */
export const SHELL_PREFIX = 'maunedas-shell-';
/** What the API answered while there was network, to read without it. */
export const API_CACHE = 'maunedas-api';
/** Photos by their path: their keys are immutable (10 §1) and only the signature in the query changes. */
export const IMAGE_CACHE = 'maunedas-images';
/** Data caches, cleared when the session ends. */
export const DATA_CACHES = [API_CACHE, IMAGE_CACHE];

/** The header a response read from the cache carries: when it was stored, in epoch ms. */
export const STORED_AT = 'X-Maunedas-Stored-At';

export interface Caches {
  open(name: string): Promise<{
    match(request: Request | string): Promise<Response | undefined>;
    put(request: Request | string, response: Response): Promise<void>;
    addAll(requests: string[]): Promise<void>;
  }>;
  keys(): Promise<string[]>;
  delete(name: string): Promise<boolean>;
}

export interface Deps {
  caches: Caches;
  fetch: (request: Request) => Promise<Response>;
  now: () => number;
  /** The worker's own origin. */
  origin: string;
  shell: string;
}

export type Route = 'navigate' | 'asset' | 'image' | 'api' | 'network';

/** The build's own files, kept at install: its hashed assets, the icons and the manifest. */
const BUILD_FILES = /^\/(assets|icons)\/|^\/manifest\.webmanifest$/;
const IMAGE_BLOB = /^\/v1\/images\/[^/]+\/blobs\/[^/]+$/;
/** Reads that must not be answered from yesterday: money spent on AI, and the editor's signed sources. */
const NOT_CACHED = [/^\/v1\/ai\//, /^\/v1\/images\//];

/** Where a request goes: only GETs of this origin are answered by the worker. */
export function routeOf(request: Request, origin: string): Route {
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== origin) return 'network';
  if (request.mode === 'navigate') return 'navigate';
  if (BUILD_FILES.test(url.pathname)) return 'asset';
  if (IMAGE_BLOB.test(url.pathname)) return 'image';
  if (url.pathname.startsWith('/v1/') && !NOT_CACHED.some((r) => r.test(url.pathname))) return 'api';
  return 'network';
}

/** Install: the whole build in its cache, so every screen opens without network, even one never visited. */
export async function install(deps: Deps, precache: string[]): Promise<void> {
  const cache = await deps.caches.open(deps.shell);
  await cache.addAll(precache);
}

/** Activate: the caches of older builds go. */
export async function activate(deps: Deps): Promise<void> {
  for (const name of await deps.caches.keys()) {
    if (name.startsWith(SHELL_PREFIX) && name !== deps.shell) await deps.caches.delete(name);
  }
}

/** A cached response marked with when it was stored, so the page can say how old it is. */
function stamped(response: Response, at: number): Response {
  const headers = new Headers(response.headers);
  headers.set(STORED_AT, String(at));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/** The answer of the worker for [request], or null to let the browser go to the network as usual. */
export async function respond(deps: Deps, request: Request): Promise<Response | null> {
  const route = routeOf(request, deps.origin);
  if (route === 'network') return null;
  if (route === 'asset') {
    const cache = await deps.caches.open(deps.shell);
    return (await cache.match(request)) ?? deps.fetch(request);
  }
  if (route === 'navigate') {
    // The page itself: fresh when there is network, the build's own copy when not (any path is the same app).
    try {
      return await deps.fetch(request);
    } catch {
      const cache = await deps.caches.open(deps.shell);
      const page = await cache.match('/');
      if (page) return page;
      throw new Error('sin conexión');
    }
  }
  if (route === 'image') {
    const cache = await deps.caches.open(IMAGE_CACHE);
    const key = new URL(request.url).pathname;
    const hit = await cache.match(key);
    if (hit) return hit;
    const response = await deps.fetch(request);
    if (response.ok) await cache.put(key, response.clone());
    return response;
  }
  // The API: the network first; what it answered well is kept for when there is none.
  const cache = await deps.caches.open(API_CACHE);
  try {
    const response = await deps.fetch(request);
    if (response.ok) await cache.put(request.url, stamped(response.clone(), deps.now()));
    return response;
  } catch (e) {
    const hit = await cache.match(request.url);
    if (hit) return hit;
    throw e;
  }
}
