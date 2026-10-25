import { render } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { AppProviders } from '../app/providers';
import { createApi } from '../lib/api';
import { createQueryClient } from '../lib/queryClient';
import { routes } from '../router';
import { FakeAuth, me } from './fakes';

type Handler = (url: URL) => unknown;

/** A fake Worker: `/v1/me` answers for the signed-in [role]; other paths by their handler (JSON) or 404. */
export function fakeWorker(handlers: Record<string, Handler>, role: 'admin' | 'member' = 'member') {
  const requests: URL[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(String(input), 'https://app.test');
    requests.push(url);
    if (url.pathname === '/v1/me') return Response.json(me(role));
    const handler = handlers[url.pathname];
    if (!handler)
      return Response.json(
        { error: { code: 'NOT_FOUND', message: 'No se encontró lo que buscas.' } },
        { status: 404 },
      );
    const body = handler(url);
    return body instanceof Response ? body : Response.json(body);
  };
  return { fetchImpl, requests };
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
