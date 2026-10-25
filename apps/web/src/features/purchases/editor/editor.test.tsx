import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { found, purchase, purchaseLookups } from '../../../test/purchases';
import { fakeWorker, renderAt } from '../../../test/render';

type Push = { mutations: Array<{ table: string; row: Record<string, unknown> }> };
const applied = (_u: URL, body: unknown) => ({
  applied: (body as Push).mutations.length,
  skipped: 0,
  conflicts: [],
});
const pushes = (posts: Array<{ path: string; body: unknown }>) =>
  posts.filter((p) => p.path === '/v1/sync/push').map((p) => (p.body as Push).mutations);
/** The editor is a lazy route: its chunk loads slowly the first time with every suite running. */
const LAZY = { timeout: 5000 };

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function worker(extra: Record<string, (url: URL, body: unknown) => unknown> = {}) {
  return fakeWorker({
    '/v1/lookups': () => purchaseLookups,
    '/v1/purchases/pu1': () => purchase,
    '/v1/sync/push': applied,
    ...extra,
  });
}

describe('W-05 purchase editor', () => {
  it('adds a product at the last price here with its 2x1, a ticket discount, and confirms a total that does not match', async () => {
    const w = worker({ '/v1/search/variants': () => ({ items: [found({ last_unit_cents: 2850 })] }) });
    const router = renderAt('/compras/nueva', w.fetchImpl);
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText('Tienda', {}, LAZY), 's-costco');
    await user.click(screen.getByRole('button', { name: '+ Producto' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Producto de la compra' }));
    await user.type(dialog.getByLabelText('Buscar producto o código'), 'leche');
    await user.click(await dialog.findByRole('button', { name: /Último aquí: \$28\.50/ }));
    expect(w.requests.find((u) => u.pathname === '/v1/search/variants')?.searchParams.get('store_id')).toBe(
      's-costco',
    );
    expect((dialog.getByLabelText('Precio unitario') as HTMLInputElement).value).toBe('28.50');
    await user.click(dialog.getByRole('button', { name: 'Una más' }));
    await user.click(dialog.getByLabelText('2x1, 3x2…'));
    await user.type(dialog.getByLabelText('Llevas'), '2');
    await user.type(dialog.getByLabelText('Pagas'), '1');
    expect(dialog.getByText('Descuento: $28.50')).toBeTruthy();
    expect(dialog.getByText('Total de la línea: $28.50')).toBeTruthy();
    expect(dialog.getByText('Precio efectivo: $14.25/L')).toBeTruthy();
    await user.click(dialog.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await user.click(screen.getByRole('button', { name: '+ Descuento del ticket' }));
    const discount = within(await screen.findByRole('dialog', { name: 'Descuento del ticket' }));
    await user.click(discount.getByRole('button', { name: 'Guardar' }));
    expect(discount.getByRole('alert').textContent).toBe('Escribe el monto.');
    await user.type(discount.getByLabelText('Monto'), '5');
    await user.click(discount.getByRole('button', { name: 'Guardar' }));
    expect(screen.getByRole('button', { name: 'Descuento' })).toBeTruthy();
    await user.type(screen.getByLabelText('Total del ticket'), '30');
    expect(screen.getByText('No cuadra por $6.50')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    const ask = within(await screen.findByRole('dialog', { name: 'El total no cuadra' }));
    expect(ask.getByText('El total no cuadra por $6.50. ¿Confirmar de todos modos?')).toBeTruthy();
    await user.click(ask.getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/compras\/[0-9a-f-]{36}$/));
    const [rows] = pushes(w.posts);
    expect(rows!.map((m) => m.table)).toEqual(['purchases', 'purchase_items', 'promotions', 'promotions']);
    expect(rows![0]!.row).toMatchObject({
      store_id: 's-costco',
      status: 'confirmed',
      discount_cents: 500,
      total_cents: 3000,
    });
    expect(rows![1]!.row).toMatchObject({
      variant_id: 'v1',
      quantity: 2,
      unit_price_cents: 2850,
      final_cents: 2850,
    });
    expect(rows![2]!.row).toMatchObject({ type: 'nxm', params: '{"n":2,"m":1}', discount_cents: 2850 });
    expect(rows![3]!.row).toMatchObject({ type: 'coupon', description: 'Descuento', discount_cents: 500 });
    expect(router.state.location.pathname).toBe(`/compras/${rows![0]!.row.id}`);
  });

  it('asks for the store first, and for a product to confirm', async () => {
    const w = worker();
    renderAt('/compras/nueva', w.fetchImpl);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: '+ Producto' }, LAZY));
    expect(screen.getByRole('alert').textContent).toBe('Primero elige la tienda.');
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(screen.getByRole('alert').textContent).toBe('Elige la tienda para confirmar.');
    await user.selectOptions(screen.getByLabelText('Tienda'), 's-soriana');
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(screen.getByRole('alert').textContent).toBe('Agrega al menos un producto para confirmar.');
    expect(pushes(w.posts)).toHaveLength(0);
  });

  it('does not confirm a product without its price (T64)', async () => {
    const noPrice = { ...purchase.items[1]!, unit_price_cents: 0, gross_cents: 0, final_cents: 0 };
    const w = worker({ '/v1/purchases/pu1': () => ({ ...purchase, items: [purchase.items[0]!, noPrice] }) });
    renderAt('/compras/pu1/editar', w.fetchImpl);
    const user = userEvent.setup();
    expect(await screen.findByText('Sin precio', {}, LAZY)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(screen.getByRole('alert').textContent).toBe(
      'Hay productos sin precio: escríbelo antes de confirmar.',
    );
    expect(pushes(w.posts)).toHaveLength(0);
  });

  it('takes a line off and back, reorders and saves the draft later than it read', async () => {
    const w = worker();
    const router = renderAt('/compras/pu1/editar', w.fetchImpl);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Quitar Sin vincular: ABARR VARIOS' }, LAZY));
    expect(screen.getByText(/^Se quitó ABARR VARIOS\./)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Deshacer' }));
    expect(screen.getByRole('button', { name: 'Subir Leche Lala · 1 L' }).hasAttribute('disabled')).toBe(
      true,
    );
    await user.click(screen.getByRole('button', { name: 'Bajar Leche Lala · 1 L' }));
    await user.click(screen.getByRole('button', { name: 'Quitar Jamón de pavo · A granel (kg)' }));
    await user.click(screen.getByRole('button', { name: 'Guardar borrador' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/compras/pu1'));
    const [rows] = pushes(w.posts);
    expect(rows!.map((m) => [m.table, m.row.id, m.row.line_no ?? m.row.deleted_at])).toEqual([
      ['purchases', 'pu1', undefined],
      ['purchase_items', 'i2', 1],
      ['purchase_items', 'i1', 2],
      ['promotions', 'pr1', undefined],
      ['promotions', 'pr2', undefined],
      ['purchase_items', 'i3', expect.any(Number)],
    ]);
    expect(Number(rows![0]!.row.updated_at)).toBeGreaterThan(1_000);
  });

  it('links a ticket line to a product, keeping its quantity and price', async () => {
    const w = worker({
      '/v1/search/variants': () => ({
        items: [
          found({
            variant_id: 'v9',
            product_name: 'Abarrotes',
            variant_label: 'Varios',
            last_unit_cents: 1500,
          }),
        ],
      }),
    });
    renderAt('/compras/pu1/editar', w.fetchImpl);
    const user = userEvent.setup();
    await user.click(await screen.findByText('Vincular', {}, LAZY));
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByText('En el ticket: ABARR VARIOS')).toBeTruthy();
    await user.type(dialog.getByLabelText('Buscar producto o código'), 'abarr');
    await user.click(await dialog.findByRole('button', { name: /Abarrotes · Varios/ }));
    expect((dialog.getByLabelText('Precio unitario') as HTMLInputElement).value).toBe('20.00');
    await user.click(dialog.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByRole('button', { name: 'Quitar Abarrotes · Varios' })).toBeTruthy();
  });

  it('saves what changed when leaving, and lets an empty new purchase go', async () => {
    const w = worker();
    const router = renderAt('/compras/pu1/editar', w.fetchImpl);
    const user = userEvent.setup();
    const total = await screen.findByLabelText('Total del ticket', {}, LAZY);
    await user.clear(total);
    await user.type(total, '71.30');
    await user.click(screen.getAllByRole('link', { name: 'Catálogo' })[0]!);
    await waitFor(() => expect(router.state.location.pathname).toBe('/catalogo'));
    expect(pushes(w.posts)[0]![0]!.row).toMatchObject({ id: 'pu1', total_cents: 7130, status: 'draft' });

    await router.navigate('/compras/nueva');
    await user.selectOptions(await screen.findByLabelText('Tienda', {}, LAZY), 's-costco');
    await user.click(screen.getAllByRole('link', { name: 'Compras' })[0]!);
    await waitFor(() => expect(router.state.location.pathname).toBe('/compras'));
    expect(pushes(w.posts)).toHaveLength(1);
  });

  it('deletes the purchase with its lines, promotions and ticket pages', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const w = worker({ '/v1/purchases': () => ({ items: [], next_cursor: null }) });
    const router = renderAt('/compras/pu1/editar', w.fetchImpl);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Eliminar compra' }, LAZY));
    await waitFor(() => expect(router.state.location.pathname).toBe('/compras'));
    expect(pushes(w.posts)[0]!.map((m) => m.table)).toEqual([
      'purchases',
      'purchase_items',
      'purchase_items',
      'purchase_items',
      'promotions',
      'promotions',
      'images',
    ]);
  });

  it('edits quantity and price in the table on a wide screen', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: true,
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    renderAt('/compras/pu1/editar', worker().fetchImpl);
    const user = userEvent.setup();
    const kilos = await screen.findByLabelText('Cantidad de Jamón de pavo · A granel (kg)', {}, LAZY);
    await user.clear(kilos);
    await user.type(kilos, '1.2');
    await user.tab();
    expect(screen.getByLabelText('Precio de Jamón de pavo · A granel (kg)')).toBe(document.activeElement);
    // 1.2 kg × $32.90 = $39.48; Σ = 28.50 + 20 + 39.48.
    expect(screen.getByText('$87.98')).toBeTruthy();
    const milk = screen.getByLabelText('Cantidad de Leche Lala · 1 L');
    fireEvent.change(milk, { target: { value: '1.5' } });
    fireEvent.blur(milk);
    expect(screen.getByRole('alert').textContent).toBe('Las piezas van en números enteros.');
    expect((milk as HTMLInputElement).value).toBe('2');
  });

  it('adds a new store and picks it', async () => {
    const stores = [...purchaseLookups.stores];
    const w = worker({
      '/v1/lookups': () => ({ ...purchaseLookups, stores }),
      '/v1/sync/push': (url, body) => {
        for (const m of (body as Push).mutations) if (m.table === 'stores') stores.push(m.row as never);
        return applied(url, body);
      },
    });
    renderAt('/compras/nueva', w.fetchImpl);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Nueva tienda' }, LAZY));
    const dialog = within(await screen.findByRole('dialog', { name: 'Nueva tienda' }));
    await user.type(dialog.getByLabelText('Nombre de la tienda'), ' Chedraui ');
    await user.click(dialog.getByLabelText('Ambas'));
    await user.click(dialog.getByRole('button', { name: 'Agregar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const [rows] = pushes(w.posts);
    expect(rows![0]).toMatchObject({
      table: 'stores',
      row: { name: 'Chedraui', kind: 'both', default_check_interval_min: 480 },
    });
    await waitFor(() =>
      expect((screen.getByLabelText('Tienda') as HTMLSelectElement).value).toBe(rows![0]!.row.id),
    );
  });
});
