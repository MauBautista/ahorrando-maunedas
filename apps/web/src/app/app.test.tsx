import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { describe, expect, it } from 'vitest';
import { createApi } from '../lib/api';
import { createQueryClient } from '../lib/queryClient';
import { routes } from '../router';
import { FakeAuth, me } from '../test/fakes';
import { AppProviders } from './providers';

/** The Worker as the app sees it: `/v1/me` answers by token; the rest of the API is not there. */
function worker(byToken: Record<string, Response | (() => Response)>) {
  const fetchImpl: typeof fetch = async (input, init) => {
    const token = new Headers(init?.headers).get('Authorization')?.replace('Bearer ', '') ?? '';
    const answer = byToken[token];
    if (!answer)
      return Response.json(
        { error: { code: 'UNAUTHENTICATED', message: 'Inicia sesión para continuar.' } },
        { status: 401 },
      );
    if (new URL(String(input), 'https://app.test').pathname !== '/v1/me')
      return Response.json({ error: { code: 'NOT_FOUND', message: 'No se encontró.' } }, { status: 404 });
    return typeof answer === 'function' ? answer() : answer.clone();
  };
  return fetchImpl;
}

function app(auth: FakeAuth, fetchImpl: typeof fetch, path = '/') {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <AppProviders auth={auth} api={createApi(auth, fetchImpl)} queryClient={createQueryClient()}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return router;
}

describe('the web app (T-160)', () => {
  it('sends a stranger to login and back where they were going after it', async () => {
    const auth = new FakeAuth();
    const router = app(auth, worker({ 'token-uid-mau': Response.json(me()) }), '/catalogo');
    await screen.findByRole('button', { name: 'Entrar' });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(screen.getByRole('alert').textContent).toBe('Escribe tu usuario y tu contraseña.');
    await user.type(screen.getByLabelText('Usuario'), 'mau');
    await user.type(screen.getByLabelText('Contraseña', { selector: 'input' }), 'mala');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Usuario o contraseña incorrectos.');
    await user.clear(screen.getByLabelText('Contraseña', { selector: 'input' }));
    await user.type(screen.getByLabelText('Contraseña', { selector: 'input' }), 'buena');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    await screen.findByRole('heading', { name: 'Catálogo' });
    expect(router.state.location.pathname).toBe('/catalogo');
  });

  it('shows Inicio with the four tabs, and admins also get Administración', async () => {
    app(new FakeAuth({ uid: 'm' }), worker({ 'token-m': Response.json(me('member')) }));
    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe('Hola, Mauricio');
    const tabs = screen.getByRole('navigation', { name: 'Secciones' });
    expect([...tabs.querySelectorAll('a')].map((a) => a.textContent)).toEqual([
      'Inicio',
      'Compras',
      'Catálogo',
      'Cuenta',
    ]);
    expect(screen.queryByRole('link', { name: 'Administración' })).toBeNull();
  });

  it('keeps admin pages for admins', async () => {
    const member = app(
      new FakeAuth({ uid: 'm' }),
      worker({ 'token-m': Response.json(me('member')) }),
      '/admin/ia',
    );
    await screen.findByRole('heading', { name: /Hola/ });
    expect(member.state.location.pathname).toBe('/');
  });

  it('opens admin pages for an admin', async () => {
    app(new FakeAuth({ uid: 'a' }), worker({ 'token-a': Response.json(me('admin')) }), '/admin/ia');
    await screen.findByRole('heading', { name: 'Gasto de IA' });
    expect(screen.getByRole('link', { name: 'Administración' })).toBeTruthy();
  });

  it('ends the session of an unregistered Google account with its message', async () => {
    const auth = new FakeAuth();
    app(
      auth,
      worker({
        'token-uid-google': Response.json(
          { error: { code: 'USER_NOT_ALLOWED', message: 'Esta cuenta no está registrada.' } },
          { status: 403 },
        ),
      }),
      '/login',
    );
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Continuar con Google' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Esta cuenta de Google no está registrada. Pídele al administrador que la agregue.',
    );
    expect([auth.signOuts, auth.currentUser()]).toEqual([1, null]);
  });

  it('offers a retry when the server cannot be reached, without signing out', async () => {
    const auth = new FakeAuth({ uid: 'm' });
    let down = true;
    app(
      auth,
      worker({
        'token-m': () =>
          down
            ? Response.json(
                { error: { code: 'INTERNAL', message: 'Ocurrió un error inesperado.' } },
                { status: 500 },
              )
            : Response.json(me()),
      }),
    );
    const retry = await screen.findByRole('button', { name: 'Reintentar' }, { timeout: 4000 });
    down = false;
    await userEvent.setup().click(retry);
    await screen.findByRole('heading', { name: /Hola/ });
    expect(auth.signOuts).toBe(0);
  });

  it('signs out from Cuenta', async () => {
    const auth = new FakeAuth({ uid: 'm' });
    const router = app(auth, worker({ 'token-m': Response.json(me()) }), '/cuenta');
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Cerrar sesión' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(auth.currentUser()).toBeNull();
  });
});
