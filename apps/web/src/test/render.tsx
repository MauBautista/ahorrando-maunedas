import { render } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { AppProviders } from '../app/providers';
import { createApi } from '../lib/api';
import { createQueryClient } from '../lib/queryClient';
import { routes } from '../router';
import { FakeAuth, me } from './fakes';

type Handler = (url: URL, body: unknown) => unknown;

/** A fake Worker: `/v1/me` answers for the signed-in [role]; other paths by their handler (JSON) or 404. */
export function fakeWorker(handlers: Record<string, Handler>, role: 'admin' | 'member' = 'member') {
  const requests: URL[] = [];
  /** What each POST sent, in order. */
  const posts: Array<{ path: string; body: unknown }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input), 'https://app.test');
    requests.push(url);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (init?.method === 'POST') posts.push({ path: url.pathname, body });
    if (url.pathname === '/v1/me') return Response.json(me(role));
    const handler = handlers[url.pathname];
    if (!handler)
      return Response.json(
        { error: { code: 'NOT_FOUND', message: 'No se encontró lo que buscas.' } },
        { status: 404 },
      );
    const answer = handler(url, body);
    return answer instanceof Response ? answer : Response.json(answer);
  };
  return { fetchImpl, requests, posts };
}

/** The whole app at [path], signed in, over the fake Worker. */
export function renderAt(path: string, fetchImpl: typeof fetch) {
  const auth = new FakeAuth({ uid: 'u' });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <AppProviders auth={auth} api={createApi(auth, fetchImpl)} queryClient={createQueryClient()}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return router;
}
