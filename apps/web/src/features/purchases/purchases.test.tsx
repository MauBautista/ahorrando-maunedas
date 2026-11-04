import type { CfdiPreviewResponse } from '@maunedas/shared/api/cfdi';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { dayTitle } from '../../lib/dates';
import { fakeWorker, renderAt } from '../../test/render';
import { CFDI_REJECTION_TEXT } from './cfdi';
import { AT, listItem, purchase, purchaseLookups } from '../../test/purchases';

const DAY = 86_400_000;
/** Pages load lazily and slowly the first time with every suite running. */
const LAZY = { timeout: 5000 };

describe('W-03 purchases', () => {
  it('groups by day of Mexico City and shows store, time, products, total and drafts', async () => {
    const now = Date.now();
    const items = [
      listItem({
        id: 'a',
        purchased_at: now,
        status: 'draft',
        branch_id: 'b-centro',
        lines_total_cents: 5000,
        discount_cents: 500,
        lines: 2,
      }),
      listItem({ id: 'b', purchased_at: now - DAY, store_id: 's-soriana', total_cents: 12345, lines: 1 }),
      listItem({ id: 'c', purchased_at: AT - 400 * DAY, store_id: 's-gone' }),
    ];
    const worker = fakeWorker({
      '/v1/lookups': () => purchaseLookups,
      '/v1/purchases': () => ({ items, next_cursor: null }),
    });
    renderAt('/compras', worker.fetchImpl);
    const today = await screen.findByRole('region', { name: 'Hoy' }, LAZY);
    const first = within(today).getByRole('link');
    expect(first.getAttribute('href')).toBe('/compras/a');
    expect(first.textContent).toContain('Costco · Centro');
    expect(first.textContent).toContain('2 productos');
    expect(first.textContent).toContain('Borrador');
    expect(first.textContent).toContain('$45.00');
    expect(within(screen.getByRole('region', { name: 'Ayer' })).getByRole('link').textContent).toContain(
      '$123.45',
    );
    expect(screen.getByText('Tienda sin sincronizar')).toBeTruthy();
  });

  it('filters by store, dates and status in the URL', async () => {
    const worker = fakeWorker({
      '/v1/lookups': () => purchaseLookups,
      '/v1/purchases': () => ({ items: [], next_cursor: null }),
    });
    renderAt('/compras', worker.fetchImpl);
    expect(
      await screen.findByText('Aún no hay compras. Registra la primera con "Nueva compra".', {}, LAZY),
    ).toBeTruthy();
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Tienda'), 's-soriana');
    await user.selectOptions(screen.getByLabelText('Estado'), 'borrador');
    await user.selectOptions(screen.getByLabelText('Fechas'), 'fechas');
    await user.type(screen.getByLabelText('Desde'), '2026-10-20');
    await screen.findByText('Ninguna compra coincide con los filtros.');
    await waitFor(() => {
      const last = worker.requests.filter((u) => u.pathname === '/v1/purchases').at(-1)!;
      expect(Object.fromEntries(last.searchParams)).toEqual({
        limit: '30',
        store_id: 's-soriana',
        status: 'draft',
        from: String(Date.parse('2026-10-20T06:00:00Z')),
      });
    });
    await user.type(screen.getByLabelText('Hasta'), '2026-10-01');
    expect((await screen.findByRole('alert')).textContent).toBe('La fecha inicial va antes de la final.');
  });
});

describe('W-04 purchase', () => {
  it('shows the products, promotions, paid per unit, ticket discounts, totals and pages', async () => {
    const worker = fakeWorker({ '/v1/lookups': () => purchaseLookups, '/v1/purchases/pu1': () => purchase });
    renderAt('/compras/pu1', worker.fetchImpl);
    expect((await screen.findByRole('heading', { level: 1 }, LAZY)).textContent).toBe('Costco · Centro');
    expect(screen.getByText(/Borrador/).textContent).toBe(
      `${dayTitle(AT, Date.now())}, 12:30 p.m. · Borrador`,
    );
    const lines = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(lines[0]).toBe('Leche Lala · 1 L$28.502 × $28.50 · 2x1$13.31/L');
    expect(lines[1]).toBe('Sin vincular: ABARR VARIOS$20.001 × $20.00');
    expect(lines[2]).toBe('Jamón de pavo · A granel (kg)$27.800.845 × $32.90$31.08/kg');
    const totals = document.querySelector('dl')!.textContent;
    expect(totals).toBe('Suma de productos$76.30Cupón app−$5.00Total calculado$71.30Total del ticket$72.00');
    expect(screen.getByRole('img', { name: 'Página 1 del ticket' }).getAttribute('src')).toBe(
      'https://img.test/t1.jpg',
    );
    expect(screen.getByRole('link', { name: 'Editar' }).getAttribute('href')).toBe('/compras/pu1/editar');
  });

  it('says a purchase is gone', async () => {
    renderAt('/compras/nada', fakeWorker({ '/v1/lookups': () => purchaseLookups }).fetchImpl);
    expect((await screen.findByRole('alert', {}, LAZY)).textContent).toBe(
      'Esta compra no existe o se eliminó.',
    );
  });
});

describe('W-02 home', () => {
  it('adds up the confirmed purchases of the month, warns of drafts and lists the recent ones', async () => {
    const worker = fakeWorker({
      '/v1/lookups': () => purchaseLookups,
      '/v1/purchases': (url) => {
        if (url.searchParams.get('status') === 'draft')
          return { items: [listItem({ status: 'draft' })], next_cursor: null };
        if (url.searchParams.get('status') === 'confirmed') {
          // Two pages of the month.
          return url.searchParams.get('cursor')
            ? { items: [listItem({ id: 'y', lines_total_cents: 1000 })], next_cursor: null }
            : { items: [listItem({ id: 'x', total_cents: 25000 })], next_cursor: 'next' };
        }
        return { items: [listItem({ id: 'r', total_cents: 9900, lines: 3 })], next_cursor: null };
      },
    });
    renderAt('/', worker.fetchImpl);
    expect(await screen.findByText('$260.00', {}, LAZY)).toBeTruthy();
    expect(
      screen
        .getByRole('link', { name: 'Tienes compras en borrador. Revísalas y confírmalas.' })
        .getAttribute('href'),
    ).toBe('/compras?estado=borrador');
    const recent = within(screen.getByRole('region', { name: 'Compras recientes' }));
    expect(recent.getByRole('link', { name: /Costco/ }).textContent).toContain('3 productos');
  });
});

describe('W-03 importing a CFDI (T-307)', () => {
  const xml = '<cfdi:Comprobante Version="4.0"/>';
  const file = () => new File([xml], 'factura.xml', { type: 'text/xml' });
  const preview = (o: Partial<CfdiPreviewResponse> = {}): CfdiPreviewResponse => ({
    fiscal_uuid: 'UUID-1',
    issued_at: AT,
    emisor: { rfc: 'CME910715UB9', name: 'COSTCO DE MEXICO' },
    total_cents: 9040,
    lines: [],
    linked: 2,
    store_id: 's-costco',
    imported_purchase_id: null,
    ...o,
  });
  const line = {
    line_no: 1,
    description: 'LECHE',
    quantity: 1,
    unit_price_cents: 1,
    gross_cents: 1,
    discount_cents: 0,
    final_cents: 1,
    sku: null,
    variant_id: null,
  };

  function worker(
    answer: unknown,
    imported: unknown = Response.json({ purchase_id: 'pu-new', lines: 3, linked: 2 }, { status: 201 }),
  ) {
    return fakeWorker({
      '/v1/lookups': () => purchaseLookups,
      '/v1/purchases': () => ({ items: [], next_cursor: null }),
      '/v1/purchases/cfdi/preview': () => answer,
      '/v1/purchases/cfdi': () => imported,
      '/v1/purchases/pu-new': () => purchase,
    });
  }

  it('reads the invoice, suggests its store and opens the draft to review', async () => {
    const w = worker(preview({ lines: [line, line, line] }));
    const router = renderAt('/compras', w.fetchImpl);
    const ui = userEvent.setup();
    await ui.click(await screen.findByRole('button', { name: 'Importar factura' }, LAZY));
    const dialog = within(screen.getByRole('dialog', { name: 'Importar factura (CFDI)' }));
    expect((dialog.getByRole('button', { name: 'Importar' }) as HTMLButtonElement).disabled).toBe(true);
    await ui.upload(dialog.getByLabelText('Archivo XML'), file());
    const summary = await dialog.findByRole('status');
    expect(summary.textContent).toContain('COSTCO DE MEXICO');
    expect(summary.textContent).toContain('Total $90.40 · 3 líneas (2 ya vinculadas)');
    expect((dialog.getByLabelText('Tienda') as HTMLSelectElement).value).toBe('s-costco');
    await ui.click(dialog.getByRole('button', { name: 'Importar' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/compras/pu-new/editar'));
    expect(w.posts.map((p) => [p.path, p.body])).toEqual([
      ['/v1/purchases/cfdi/preview', { xml }],
      ['/v1/purchases/cfdi', { xml, store_id: 's-costco' }],
    ]);
  });

  it('asks for the store when the issuer does not say it', async () => {
    const w = worker(preview({ store_id: null }));
    renderAt('/compras', w.fetchImpl);
    const ui = userEvent.setup();
    await ui.click(await screen.findByRole('button', { name: 'Importar factura' }, LAZY));
    const dialog = within(screen.getByRole('dialog'));
    await ui.upload(dialog.getByLabelText('Archivo XML'), file());
    await dialog.findByRole('status');
    await ui.click(dialog.getByRole('button', { name: 'Importar' }));
    expect(dialog.getByRole('alert').textContent).toBe('Elige la tienda de la factura.');
    await ui.selectOptions(dialog.getByLabelText('Tienda'), 'Soriana');
    await ui.click(dialog.getByRole('button', { name: 'Importar' }));
    await waitFor(() => expect(w.posts.at(-1)?.body).toEqual({ xml, store_id: 's-soriana' }));
  });

  it('says why a file is not imported, or that it already was', async () => {
    const rejected = worker(
      Response.json(
        { error: { code: 'UNSUPPORTED_CFDI', message: 'x', details: { reason: 'NOT_INCOME' } } },
        { status: 422 },
      ),
    );
    renderAt('/compras', rejected.fetchImpl);
    const ui = userEvent.setup();
    await ui.click(await screen.findByRole('button', { name: 'Importar factura' }, LAZY));
    let dialog = within(screen.getByRole('dialog'));
    await ui.upload(dialog.getByLabelText('Archivo XML'), file());
    expect((await dialog.findByRole('alert')).textContent).toBe(CFDI_REJECTION_TEXT.NOT_INCOME);
    expect(dialog.queryByLabelText('Tienda')).toBeNull();
    await ui.click(dialog.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    // Already imported: in the preview, or when importing.
    cleanup();
    const twice = worker(
      preview(),
      Response.json(
        { error: { code: 'CFDI_ALREADY_IMPORTED', message: 'x', details: { purchase_id: 'pu-old' } } },
        { status: 409 },
      ),
    );
    renderAt('/compras', twice.fetchImpl);
    await ui.click(await screen.findByRole('button', { name: 'Importar factura' }, LAZY));
    dialog = within(screen.getByRole('dialog'));
    await ui.upload(dialog.getByLabelText('Archivo XML'), file());
    await dialog.findByRole('status');
    await ui.click(dialog.getByRole('button', { name: 'Importar' }));
    const notice = await dialog.findByRole('alert');
    expect(notice.textContent).toContain('Esta factura ya se importó.');
    expect(within(notice).getByRole('link', { name: 'Ver la compra' }).getAttribute('href')).toBe(
      '/compras/pu-old',
    );
    expect((dialog.getByRole('button', { name: 'Importar' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
