import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { found, purchaseLookups } from '../../test/purchases';
import { fakeWorker, renderAt } from '../../test/render';

vi.mock('../../lib/images', () => ({
  PHOTO: { maxSide: 2048, quality: 0.85 },
  downscaleToJpeg: async () => new Blob(['jpeg'], { type: 'image/jpeg' }),
}));

type Push = { mutations: Array<{ table: string; row: Record<string, unknown> }> };
const applied = (_u: URL, body: unknown) => ({
  applied: (body as Push).mutations.length,
  skipped: 0,
  conflicts: [],
});
const LAZY = { timeout: 5000 };
const milk = found({ last_unit_cents: 2850 });

// jsdom has no object URLs: the preview gets a fake one.
beforeEach(() => {
  URL.createObjectURL = () => 'blob:anaquel';
  URL.revokeObjectURL = () => {};
});
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

function worker(extra: Record<string, (url: URL, body: unknown) => unknown> = {}) {
  return fakeWorker({
    '/v1/lookups': () => purchaseLookups,
    '/v1/search/variants': (url) => ({
      items:
        url.searchParams.get('q') === '0000000000'
          ? []
          : [{ ...milk, barcode_match: url.searchParams.get('q') === '7501020515343' }],
    }),
    '/v1/sync/push': applied,
    '/v1/images/*': () => new Response(null, { status: 204 }),
    '/v1/products/p1': () => new Response(null, { status: 404 }),
    ...extra,
  });
}

describe('W-10 shelf price', () => {
  it('saves a 2x1 with its photo at the remembered store, uploads the photo and opens the product', async () => {
    localStorage.setItem(
      'maunedas.shelf_place',
      JSON.stringify({ storeId: 's-costco', branchId: 'b-centro' }),
    );
    const w = worker();
    const router = renderAt('/anaquel/nuevo', w.fetchImpl);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Buscar producto o código', {}, LAZY), 'leche');
    await user.click(await screen.findByRole('button', { name: 'Leche Lala · 1 L' }, LAZY));
    expect((screen.getByLabelText('Tienda') as HTMLSelectElement).value).toBe('s-costco');
    expect((screen.getByLabelText('Sucursal (opcional)') as HTMLSelectElement).value).toBe('b-centro');
    await user.type(screen.getByLabelText('Precio en el anaquel'), '89');
    expect(screen.getByText('Por unidad: $89.00/L')).toBeTruthy();
    await user.click(screen.getByLabelText('2x1, 3x2…'));
    await user.type(screen.getByLabelText('Llevas'), '2');
    await user.type(screen.getByLabelText('Pagas'), '1');
    expect(screen.getByText('Con la promoción: $44.50 cada uno · $44.50/L')).toBeTruthy();
    await user.upload(
      screen.getByLabelText('Tomar foto del anaquel'),
      new File(['raw'], 'anaquel.jpg', { type: 'image/jpeg' }),
    );
    expect(await screen.findByRole('img', { name: 'Foto del anaquel' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/productos/p1'));
    const [pushed, upload] = w.posts;
    const rows = (pushed!.body as Push).mutations;
    expect(rows.map((m) => m.table)).toEqual(['price_observations', 'images', 'promotions']);
    expect(rows[0]!.row).toMatchObject({
      variant_id: 'v1',
      store_id: 's-costco',
      branch_id: 'b-centro',
      price_cents: 8900,
      effective_price_cents: 4450,
      promo_text: '2x1',
    });
    // The binary goes up after its row exists, at the image's own path.
    expect(upload!.path).toBe(`/v1/images/${rows[1]!.row.id}/blobs/original.jpg`);
    expect((upload!.body as Blob).type).toBe('image/jpeg');
  });

  it('"Guardar y otro" keeps the store, says it was saved and starts over; it remembers the store for next time', async () => {
    const w = worker();
    renderAt('/anaquel/nuevo', w.fetchImpl);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Guardar' }, LAZY));
    expect(screen.getByRole('alert').textContent).toBe('Elige el producto.');
    await user.type(screen.getByLabelText('Buscar producto o código'), 'leche');
    await user.click(await screen.findByRole('button', { name: 'Leche Lala · 1 L' }, LAZY));
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(screen.getByRole('alert').textContent).toBe('Elige la tienda.');
    await user.selectOptions(screen.getByLabelText('Tienda'), 's-soriana');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(screen.getByRole('alert').textContent).toBe('Escribe el precio.');
    await user.type(screen.getByLabelText('Precio en el anaquel'), '0');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(screen.getByRole('alert').textContent).toBe('Escribe el precio.');
    await user.clear(screen.getByLabelText('Precio en el anaquel'));
    await user.type(screen.getByLabelText('Precio en el anaquel'), '27.50');
    await user.click(screen.getByRole('button', { name: 'Guardar y otro' }));
    expect((await screen.findByRole('status')).textContent).toBe('Precio guardado');
    expect((screen.getByLabelText('Tienda') as HTMLSelectElement).value).toBe('s-soriana');
    expect((screen.getByLabelText('Precio en el anaquel') as HTMLInputElement).value).toBe('');
    expect(screen.getByLabelText('Buscar producto o código')).toBeTruthy();
    expect(JSON.parse(localStorage.getItem('maunedas.shelf_place')!)).toEqual({
      storeId: 's-soriana',
      branchId: null,
    });
    expect(w.posts).toHaveLength(1);
  });

  it('picks the product of a scanned code, and points a code not in the catalog to the editor', async () => {
    const w = worker();
    renderAt('/anaquel/nuevo', w.fetchImpl);
    const user = userEvent.setup();
    // jsdom has no camera: the scanner takes the typed code.
    await user.click(await screen.findByRole('button', { name: 'Escanear código' }, LAZY));
    await user.type(
      within(screen.getByRole('dialog')).getByLabelText('O escribe el código'),
      '0000000000{Enter}',
    );
    const link = await screen.findByRole('link', { name: 'Darlo de alta' });
    expect(link.getAttribute('href')).toBe('/productos/nuevo?codigo=0000000000');
    expect(screen.getByText(/El código 0000000000 no está en tu catálogo\./)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Escanear código' }));
    await user.type(
      within(screen.getByRole('dialog')).getByLabelText('O escribe el código'),
      '7501020515343{Enter}',
    );
    expect(await screen.findByText('Leche Lala · 1 L')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Darlo de alta' })).toBeNull();
  });

  it('keeps the price when the photo cannot go up, and says so', async () => {
    localStorage.setItem('maunedas.shelf_place', JSON.stringify({ storeId: 's-costco', branchId: null }));
    const w = worker({ '/v1/images/*': () => new Response('{}', { status: 500 }) });
    const router = renderAt('/anaquel/nuevo', w.fetchImpl);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Buscar producto o código', {}, LAZY), 'leche');
    await user.click(await screen.findByRole('button', { name: 'Leche Lala · 1 L' }, LAZY));
    await user.type(screen.getByLabelText('Precio en el anaquel'), '30');
    await user.upload(
      screen.getByLabelText('Tomar foto del anaquel'),
      new File(['raw'], 'a.jpg', { type: 'image/jpeg' }),
    );
    await screen.findByRole('img', { name: 'Foto del anaquel' });
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect((await screen.findByRole('status')).textContent).toBe(
      'El precio se guardó, pero la foto no se pudo subir.',
    );
    expect(router.state.location.pathname).toBe('/anaquel/nuevo');
  });
});
