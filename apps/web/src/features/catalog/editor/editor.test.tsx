import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { detail, lookups } from '../../../test/catalog';
import { fakeWorker, renderAt } from '../../../test/render';

type Push = { device_id: string; mutations: Array<{ table: string; row: Record<string, unknown> }> };
const applied = (body: unknown) => ({ applied: (body as Push).mutations.length, skipped: 0, conflicts: [] });
const pushes = (posts: Array<{ path: string; body: unknown }>) =>
  posts.filter((p) => p.path === '/v1/sync/push').map((p) => (p.body as Push).mutations);

afterEach(() => vi.restoreAllMocks());

/** The editor is a lazy route: its chunk loads slowly the first time with every suite running. */
const LAZY = 5000;

describe('W-09 editor', () => {
  it('creates a product with its first variant and code in one push', async () => {
    const worker = fakeWorker({
      '/v1/lookups': () => lookups,
      '/v1/search/variants': () => ({ items: [] }),
      '/v1/sync/push': (_u, body) => applied(body),
    });
    const router = renderAt('/productos/nuevo', worker.fetchImpl);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Nombre', {}, { timeout: LAZY }), 'Leche Lala');
    // The unit to compare follows the measure until one is picked.
    await user.click(screen.getByLabelText('Masa'));
    expect((screen.getByLabelText('Comparar precios por') as HTMLSelectElement).value).toBe('kg');
    await user.click(screen.getByLabelText('Volumen'));
    // Back in volume the unit starts at ml, as in Android.
    await user.selectOptions(screen.getByLabelText('Unidad'), 'L');
    await user.type(screen.getByLabelText('Contenido'), '1');
    expect((screen.getByLabelText('Etiqueta') as HTMLInputElement).value).toBe('1 L');
    await user.type(screen.getByLabelText('Nuevo código'), '750-1020-515343');
    await user.click(screen.getByRole('button', { name: 'Agregar código' }));
    await screen.findByRole('button', { name: 'Quitar 7501020515343' }, { timeout: LAZY });
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    // Typing a whole form is slow in jsdom when every suite runs at once.
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/productos\/[0-9a-f-]{36}$/), {
      timeout: 5000,
    });
    const [mutations] = pushes(worker.posts);
    expect(mutations!.map((m) => m.table)).toEqual(['products', 'variants', 'barcodes']);
    expect(mutations![0]!.row).toMatchObject({ name: 'Leche Lala', display_unit: 'L', brand: null });
    expect(mutations![1]!.row).toMatchObject({
      label: '1 L',
      measure: 'volume',
      unit_amount: 1000,
      pack_count: 1,
      sold_by_weight: 0,
    });
    expect(router.state.location.pathname).toBe(`/productos/${mutations![0]!.row.id}`);
  });

  it('says whose a code already is, and what is missing before saving', async () => {
    const owner = {
      variant_id: 'v9',
      product_id: 'p9',
      product_name: 'Leche Alpura',
      brand: null,
      variant_label: '1 L',
      barcode_match: true,
      image: null,
    };
    const worker = fakeWorker({
      '/v1/lookups': () => lookups,
      '/v1/search/variants': () => ({ items: [owner] }),
    });
    renderAt('/productos/nuevo', worker.fetchImpl);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Nuevo código', {}, { timeout: LAZY }), '7501020515343');
    await user.click(screen.getByRole('button', { name: 'Agregar código' }));
    expect((await screen.findByText(/Ese código ya es de/)).textContent).toBe(
      'Ese código ya es de «Leche Alpura · 1 L».',
    );
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(screen.getByText('Escribe el nombre del producto.')).toBeTruthy();
    expect(screen.getByText('Escribe una cantidad mayor que cero, por ejemplo 1.5')).toBeTruthy();
    expect(worker.posts.filter((p) => p.path === '/v1/sync/push')).toHaveLength(0);
  });

  it('starts with a code that was not in the catalog, and scans another one', async () => {
    const worker = fakeWorker({ '/v1/lookups': () => lookups, '/v1/search/variants': () => ({ items: [] }) });
    renderAt('/productos/nuevo?codigo=7501020515343', worker.fetchImpl);
    const user = userEvent.setup();
    expect(
      await screen.findByRole('button', { name: 'Quitar 7501020515343' }, { timeout: LAZY }),
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Escanear' }));
    await user.type(
      within(screen.getByRole('dialog')).getByLabelText('O escribe el código'),
      '7501055300075{Enter}',
    );
    expect(await screen.findByRole('button', { name: 'Quitar 7501055300075' })).toBeTruthy();
    // The scanned code was checked against the catalog like a typed one.
    expect(
      worker.requests.some(
        (u) => u.pathname === '/v1/search/variants' && u.searchParams.get('q') === '7501055300075',
      ),
    ).toBe(true);
  });

  it('edits a variant in its dialog, later than the row it read', async () => {
    const worker = fakeWorker({
      '/v1/lookups': () => lookups,
      '/v1/products/p1': () => detail,
      '/v1/sync/push': (_u, body) => applied(body),
    });
    renderAt('/productos/p1/editar', worker.fetchImpl);
    const user = userEvent.setup();
    expect(((await screen.findByLabelText('Nombre', {}, { timeout: LAZY })) as HTMLInputElement).value).toBe(
      'Leche Lala Entera',
    );
    // A member does not delete.
    expect(screen.queryByRole('button', { name: 'Eliminar producto' })).toBeNull();
    await user.click(screen.getByRole('button', { name: '1 L' }));
    const dialog = await screen.findByRole('dialog', { name: 'Editar presentación' }, { timeout: LAZY });
    expect(within(dialog).queryByRole('button', { name: 'Eliminar presentación' })).toBeNull();
    // Clearing the label brings the suggestion back (T-113), so the new one replaces it whole.
    fireEvent.change(within(dialog).getByLabelText('Etiqueta'), { target: { value: 'Litro' } });
    await user.click(within(dialog).getByRole('button', { name: 'Quitar 7501020515343' }));
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const [mutations] = pushes(worker.posts);
    expect(mutations!.map((m) => [m.table, m.row.id])).toEqual([
      ['variants', 'v1'],
      ['barcodes', 'b1'],
    ]);
    expect(mutations![0]!.row).toMatchObject({ label: 'Litro', product_id: 'p1' });
    expect(Number(mutations![0]!.row.updated_at)).toBeGreaterThan(1_000);
  });

  it('lets an admin delete the product with its variants and codes', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const worker = fakeWorker(
      {
        '/v1/lookups': () => lookups,
        '/v1/products/p1': () => detail,
        '/v1/products': () => ({ items: [], next_cursor: null }),
        '/v1/sync/push': (_u, body) => applied(body),
      },
      'admin',
    );
    const router = renderAt('/productos/p1/editar', worker.fetchImpl);
    await userEvent
      .setup()
      .click(await screen.findByRole('button', { name: 'Eliminar producto' }, { timeout: LAZY }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/catalogo'));
    expect(pushes(worker.posts)[0]!.map((m) => [m.table, m.row.id])).toEqual([
      ['products', 'p1'],
      ['variants', 'v1'],
      ['barcodes', 'b1'],
      ['variants', 'v2'],
    ]);
  });

  it('says when someone else changed the product meanwhile', async () => {
    const worker = fakeWorker({
      '/v1/lookups': () => lookups,
      '/v1/products/p1': () => detail,
      '/v1/sync/push': () => ({
        applied: 0,
        skipped: 1,
        conflicts: [{ table: 'products', id: 'p1', reason: 'STALE', server_row: {} }],
      }),
    });
    const router = renderAt('/productos/p1/editar', worker.fetchImpl);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Marca (opcional)', {}, { timeout: LAZY }), ' MX');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect((await screen.findByRole('alert', {}, { timeout: LAZY })).textContent).toBe(
      'Alguien más cambió esto mientras lo editabas; se recargó con sus cambios.',
    );
    expect(router.state.location.pathname).toBe('/productos/p1/editar');
    // The form shows the server's product again.
    expect((screen.getByLabelText('Marca (opcional)') as HTMLInputElement).value).toBe('Lala');
  });
});
