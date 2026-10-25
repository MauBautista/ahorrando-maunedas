import type { AdminUser } from '@maunedas/shared/api/admin';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { found } from '../../test/purchases';
import { fakeWorker, renderAt } from '../../test/render';
import { movedText } from './merge';

const LAZY = { timeout: 5000 };
const user = (o: Partial<AdminUser>): AdminUser => ({
  id: 'u-ana',
  username: 'ana',
  display_name: 'Ana',
  role: 'member',
  active: true,
  google_email: null,
  has_password: true,
  created_at: Date.parse('2026-10-01T18:00:00Z'),
  ...o,
});
const fail = (status: number, code: string, message: string, details?: unknown) =>
  Response.json({ error: { code, message, details } }, { status });

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function users(list: AdminUser[], extra: Record<string, (url: URL, body: unknown) => unknown> = {}) {
  return fakeWorker(
    {
      '/v1/admin/users': (_u, body) =>
        body
          ? Response.json({ user: user({ id: 'u-new', ...(body as object) }) }, { status: 201 })
          : { items: list },
      '/v1/admin/users/*': (_u, body) =>
        body && 'password' in (body as object)
          ? new Response(null, { status: 204 })
          : { user: user({ ...(body as object) }) },
      ...extra,
    },
    'admin',
  );
}

describe('W-11 users', () => {
  it('lists the users with their role, Google and state', async () => {
    renderAt(
      '/admin/usuarios',
      users([
        user({
          id: 'u1',
          username: 'mau',
          display_name: 'Mau',
          role: 'admin',
          google_email: 'mau@gmail.com',
        }),
        user({ active: false }),
      ]).fetchImpl,
    );
    const [mau, ana] = within(await screen.findByRole('list', {}, LAZY)).getAllByRole('listitem');
    expect(mau!.textContent).toContain('Mau (tú) · mau');
    expect(mau!.textContent).toContain('Administrador · Activo · mau@gmail.com · Desde 1 oct 2026');
    expect(ana!.textContent).toContain('Miembro · Desactivado · Sin Google');
    expect(within(ana!).getByRole('button', { name: 'Activar a ana' })).toBeTruthy();
  });

  it('creates a user with a generated password, after saying what is missing', async () => {
    const w = users([]);
    renderAt('/admin/usuarios', w.fetchImpl);
    const ui = userEvent.setup();
    await ui.click(await screen.findByRole('button', { name: 'Nuevo usuario' }, LAZY));
    const dialog = within(screen.getByRole('dialog', { name: 'Nuevo usuario' }));
    const say = async () => {
      await ui.click(dialog.getByRole('button', { name: 'Crear' }));
      return dialog.getByRole('alert').textContent;
    };
    await ui.type(dialog.getByLabelText('Usuario'), 'a');
    expect(await say()).toBe(
      'El usuario debe tener de 3 a 32 caracteres: minúsculas, números, punto, guion o guion bajo.',
    );
    await ui.clear(dialog.getByLabelText('Usuario'));
    await ui.type(dialog.getByLabelText('Usuario'), '  Ana.Lopez ');
    expect(await say()).toBe('Escribe el nombre.');
    await ui.type(dialog.getByLabelText('Nombre'), 'Ana López');
    expect(await say()).toBe('Escribe una contraseña o un correo de Google.');
    await ui.type(dialog.getByLabelText('Contraseña inicial'), 'corta');
    expect(await say()).toBe('La contraseña debe tener al menos 8 caracteres.');
    await ui.click(dialog.getByRole('button', { name: 'Generar' }));
    const generated = (dialog.getByLabelText('Contraseña inicial') as HTMLInputElement).value;
    expect(generated).toHaveLength(12);
    await ui.click(dialog.getByLabelText('Administrador'));
    await ui.click(dialog.getByRole('button', { name: 'Crear' }));
    expect((await screen.findByRole('status')).textContent).toBe('Se creó «ana.lopez».');
    expect(w.posts).toEqual([
      {
        path: '/v1/admin/users',
        method: 'POST',
        body: { username: 'ana.lopez', display_name: 'Ana López', role: 'admin', password: generated },
      },
    ]);
    // The list is asked again.
    expect(w.requests.filter((u) => u.pathname === '/v1/admin/users')).toHaveLength(2 + 1);
  });

  it("shows the server's reason, as it comes", async () => {
    const w = users([], {
      '/v1/admin/users': (_u, body) =>
        body ? fail(409, 'USERNAME_TAKEN', 'Ese usuario ya existe.') : { items: [] },
    });
    renderAt('/admin/usuarios', w.fetchImpl);
    const ui = userEvent.setup();
    await ui.click(await screen.findByRole('button', { name: 'Nuevo usuario' }, LAZY));
    const dialog = within(screen.getByRole('dialog'));
    await ui.type(dialog.getByLabelText('Usuario'), 'ana');
    await ui.type(dialog.getByLabelText('Nombre'), 'Ana');
    await ui.type(dialog.getByLabelText('Correo de Google (opcional)'), 'ana@gmail.com');
    await ui.click(dialog.getByRole('button', { name: 'Crear' }));
    expect((await dialog.findByRole('alert')).textContent).toBe('Ese usuario ya existe.');
    expect(w.posts[0]!.body).toEqual({
      username: 'ana',
      display_name: 'Ana',
      role: 'member',
      google_email: 'ana@gmail.com',
    });
  });

  it('edits only what changed, and warns that removing Google closes that access', async () => {
    const w = users([user({ google_email: 'ana@gmail.com' })]);
    renderAt('/admin/usuarios', w.fetchImpl);
    const ui = userEvent.setup();
    await ui.click(await screen.findByRole('button', { name: 'Editar a ana' }, LAZY));
    let dialog = within(screen.getByRole('dialog', { name: 'Editar a ana' }));
    await ui.click(dialog.getByRole('button', { name: 'Guardar' }));
    expect(w.posts).toHaveLength(0);
    await ui.click(screen.getByRole('button', { name: 'Editar a ana' }));
    dialog = within(screen.getByRole('dialog'));
    await ui.clear(dialog.getByLabelText('Correo de Google (opcional)'));
    expect(
      dialog.getByText('Al cambiar o quitar el correo, su acceso con Google anterior se cierra.'),
    ).toBeTruthy();
    await ui.click(dialog.getByLabelText('Administrador'));
    await ui.click(dialog.getByRole('button', { name: 'Guardar' }));
    expect((await screen.findByRole('status')).textContent).toBe('Se guardaron los cambios de «ana».');
    expect(w.posts).toEqual([
      { path: '/v1/admin/users/u-ana', method: 'PATCH', body: { role: 'admin', google_email: null } },
    ]);
  });

  it('resets a password and deactivates after asking; the last admin is kept', async () => {
    const w = users([user({})], {
      '/v1/admin/users/*': (_u, body) =>
        'password' in (body as object)
          ? new Response(null, { status: 204 })
          : fail(409, 'LAST_ADMIN', 'Debe quedar al menos un administrador activo.'),
    });
    renderAt('/admin/usuarios', w.fetchImpl);
    const ui = userEvent.setup();
    await ui.click(await screen.findByRole('button', { name: 'Restablecer la contraseña de ana' }, LAZY));
    const dialog = within(screen.getByRole('dialog', { name: 'Contraseña nueva para ana' }));
    await ui.type(dialog.getByLabelText('Contraseña nueva'), 'corta');
    await ui.click(dialog.getByRole('button', { name: 'Cambiar contraseña' }));
    expect(dialog.getByRole('alert').textContent).toBe('La contraseña debe tener al menos 8 caracteres.');
    await ui.type(dialog.getByLabelText('Contraseña nueva'), '-larga');
    await ui.click(dialog.getByRole('button', { name: 'Cambiar contraseña' }));
    expect((await screen.findByRole('status')).textContent).toBe('Se cambió la contraseña de «ana».');
    expect(w.posts.at(-1)).toEqual({
      path: '/v1/admin/users/u-ana/password',
      method: 'POST',
      body: { password: 'corta-larga' },
    });

    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    await ui.click(screen.getByRole('button', { name: 'Desactivar a ana' }));
    expect(confirm).toHaveBeenCalledWith('¿Desactivar a «Ana»? Ya no podrá entrar.');
    expect(w.posts).toHaveLength(1);
    await ui.click(screen.getByRole('button', { name: 'Desactivar a ana' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Debe quedar al menos un administrador activo.',
    );
    expect(w.posts.at(-1)).toMatchObject({ method: 'PATCH', body: { active: false } });
  });

  it('is a table on a wide screen', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: true,
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    renderAt('/admin/usuarios', users([user({})]).fetchImpl);
    const table = await screen.findByRole('table', {}, LAZY);
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['Usuario', 'Nombre', 'Rol', 'Google', 'Estado', 'Acciones']);
    expect(within(table).getAllByRole('row')[1]!.textContent).toContain('anaAnaMiembro—Activo');
  });
});

describe('W-12 merge', () => {
  const products = {
    items: [
      {
        id: 'p-dup',
        name: 'Leche Lala',
        brand: null,
        category_id: null,
        display_unit: 'L',
        image: null,
        variants: 2,
        best: null,
      },
      {
        id: 'p-ok',
        name: 'Leche Lala Entera',
        brand: 'Lala',
        category_id: null,
        display_unit: 'L',
        image: null,
        variants: 1,
        best: null,
      },
    ],
    next_cursor: null,
  };

  it('previews what moves, asks with Android’s words and merges', async () => {
    const w = fakeWorker(
      {
        '/v1/products': () => products,
        '/v1/admin/merge': (_u, body) => ({
          moved: (body as { dry_run?: boolean }).dry_run
            ? { variants: 2, images: 1, product_tags: 0 }
            : { variants: 2, images: 1, product_tags: 0 },
        }),
      },
      'admin',
    );
    renderAt('/admin/fusionar', w.fetchImpl);
    const ui = userEvent.setup();
    await ui.type(await screen.findByLabelText('Buscar el duplicado (se elimina)', {}, LAZY), 'leche');
    await ui.click(await screen.findByRole('button', { name: 'Leche Lala' }, LAZY));
    await ui.type(screen.getByLabelText('Buscar el que se queda'), 'leche');
    // The duplicate is not offered as the one that stays.
    const stays = await screen.findByRole('button', { name: 'Leche Lala Entera · Lala' }, LAZY);
    expect(screen.queryByRole('button', { name: 'Leche Lala' })).toBeNull();
    await ui.click(stays);
    expect((await screen.findByText(/Pasarán a/)).textContent).toBe(
      'Pasarán a «Leche Lala Entera · Lala»: 2 presentaciones y 1 foto.',
    );
    expect(w.posts[0]).toEqual({
      path: '/v1/admin/merge',
      method: 'POST',
      body: { kind: 'product', source_id: 'p-dup', target_id: 'p-ok', dry_run: true },
    });
    await ui.click(screen.getByRole('button', { name: 'Fusionar' }));
    const ask = within(screen.getByRole('dialog', { name: 'Fusionar' }));
    expect(
      ask.getByText(
        /Sus presentaciones, fotos y etiquetas pasan a «Leche Lala Entera · Lala», y «Leche Lala» se elimina\. No se puede deshacer\./,
      ),
    ).toBeTruthy();
    await ui.click(ask.getByRole('button', { name: 'Fusionar' }));
    expect((await screen.findByRole('status')).textContent).toBe(
      'Listo: «Leche Lala» se fusionó en «Leche Lala Entera · Lala» (2 presentaciones y 1 foto).',
    );
    expect(w.posts[1]).toEqual({
      path: '/v1/admin/merge',
      method: 'POST',
      body: { kind: 'product', source_id: 'p-dup', target_id: 'p-ok' },
    });
    expect(screen.getByLabelText('Buscar el duplicado (se elimina)')).toBeTruthy();
  });

  it('offers only variants of the same measure, and says why the server refuses', async () => {
    const w = fakeWorker(
      {
        '/v1/search/variants': () => ({
          items: [
            found({ variant_id: 'v-a', variant_label: '1 L' }),
            found({ variant_id: 'v-b', variant_label: '1 L (otra)' }),
            found({ variant_id: 'v-kg', variant_label: '1 kg', measure: 'mass' }),
          ],
        }),
        '/v1/admin/merge': () =>
          fail(409, 'MERGE_INVALID', 'No se pueden fusionar esos registros.', { reason: 'DELETED' }),
      },
      'admin',
    );
    renderAt('/admin/fusionar', w.fetchImpl);
    const ui = userEvent.setup();
    await ui.click(await screen.findByLabelText('Presentaciones', {}, LAZY));
    await ui.type(screen.getByLabelText('Buscar el duplicado (se elimina)'), 'leche');
    await ui.click(await screen.findByRole('button', { name: 'Leche Lala · 1 L' }, LAZY));
    await ui.type(screen.getByLabelText('Buscar el que se queda'), 'leche');
    const other = await screen.findByRole('button', { name: 'Leche Lala · 1 L (otra)' }, LAZY);
    // Neither the duplicate itself nor another measure.
    expect(screen.queryByRole('button', { name: 'Leche Lala · 1 kg' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Leche Lala · 1 L' })).toBeNull();
    await ui.click(other);
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Uno de los dos ya se eliminó. Búscalos otra vez.',
    );
    expect(w.posts[0]!.body).toMatchObject({
      kind: 'variant',
      source_id: 'v-a',
      target_id: 'v-b',
      dry_run: true,
    });
  });

  it('writes what moves as a person reads it', () => {
    expect(movedText({ barcodes: 2, purchase_items: 1, price_observations: 0, images: 3 })).toBe(
      '2 códigos, 1 producto de compra y 3 fotos',
    );
    expect(movedText({ variants: 0 })).toBeNull();
  });
});

describe('W-13 AI spending', () => {
  it('shows the month against the cap, by purpose, and the soft limit banner', async () => {
    const budget = {
      month: '2026-10',
      budget_usd: 6,
      spent_usd: 5.1,
      soft_limit_pct: 80,
      soft_limit_reached: true,
      by_purpose: { receipt: 4.9876, image_edit: 0.1124, other: 0 },
      calls: 41,
    };
    renderAt('/admin/ia', fakeWorker({ '/v1/admin/ai-budget': () => budget }, 'admin').fetchImpl);
    expect((await screen.findByRole('alert', {}, LAZY)).textContent).toBe(
      'El gasto de este mes ya pasó el 80 % del tope. Al llegar al tope, la IA se pausa hasta el mes siguiente.',
    );
    expect(screen.getByText('octubre de 2026')).toBeTruthy();
    expect(
      screen.getByRole('progressbar', { name: 'Gasto del mes contra el tope' }).getAttribute('aria-valuenow'),
    ).toBe('85');
    expect(screen.getByText('85 % del tope · 41 llamadas')).toBeTruthy();
    // es-MX writes dollars with a no-break space.
    expect(document.querySelector('dl')!.textContent!.replace(/\u00A0/g, ' ')).toBe(
      'TicketsUSD 4.9876Edición de fotosUSD 0.1124OtrosUSD 0.00',
    );
  });
});
