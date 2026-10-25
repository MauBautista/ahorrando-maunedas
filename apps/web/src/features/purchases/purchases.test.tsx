import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { dayTitle } from '../../lib/dates';
import { fakeWorker, renderAt } from '../../test/render';
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
