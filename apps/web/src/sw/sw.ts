import { activate, install, respond, routeOf, SHELL_PREFIX, type Deps } from './strategies';

// The service worker (T-310, 06 §9). The build puts here the list of its own files and their version
// (`precacheManifest` in vite.config.ts); the decisions are in `strategies.ts`.

declare const __PRECACHE__: string[];
declare const __BUILD__: string;

interface ExtendableEvent extends Event {
  waitUntil(work: Promise<unknown>): void;
}
interface FetchEvent extends ExtendableEvent {
  request: Request;
  respondWith(response: Promise<Response>): void;
}
interface WorkerScope {
  location: Location;
  caches: Deps['caches'];
  skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void> };
  addEventListener(type: 'install' | 'activate', listener: (event: ExtendableEvent) => void): void;
  addEventListener(type: 'fetch', listener: (event: FetchEvent) => void): void;
}

const scope = self as unknown as WorkerScope;
const deps: Deps = {
  caches: scope.caches,
  fetch: (request) => fetch(request),
  now: () => Date.now(),
  origin: scope.location.origin,
  shell: `${SHELL_PREFIX}${__BUILD__}`,
};

scope.addEventListener('install', (event) => {
  event.waitUntil(install(deps, __PRECACHE__).then(() => scope.skipWaiting()));
});

scope.addEventListener('activate', (event) => {
  event.waitUntil(activate(deps).then(() => scope.clients.claim()));
});

scope.addEventListener('fetch', (event) => {
  // Writes, uploads and other origins (Firebase) go to the network as if the worker were not there.
  if (routeOf(event.request, deps.origin) === 'network') return;
  event.respondWith(respond(deps, event.request).then((r) => r ?? fetch(event.request)));
});
