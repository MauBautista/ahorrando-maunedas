import type { ProductsResponse } from '@maunedas/shared/api/catalog';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeWorker, renderAt } from '../../test/render';
import { detail, lookups, NOW } from '../../test/catalog';
import { describeHistory } from './describeHistory';

const product = (id: string, name: string, best: boolean) => ({
  id,
  name,
  brand: 'Lala',
  category_id: 'c-lacteos',
  display_unit: 'L' as const,
  image: null,
  variants: 2,
  best: best
    ? {
        variant_id: 'v1',
        variant_label: '1 L',
        display_cents: 2_650,
        display_unit: 'L' as const,
        store_id: 's-soriana',
        source: 'shelf' as const,
        observed_at: NOW,
      }
    : null,
});

describe('W-07 catálogo', () => {
  it('lists products with their best price, filters by search, category and tag, and pages', async () => {
    const pages: Record<string, ProductsResponse> = {
      '': {
        items: [product('p1', 'Leche Lala Entera', true), product('p2', 'Leche Lala Light', false)],
        next_cursor: 'c2',
      },
      c2: { items: [product('p3', 'Leche Deslactosada', false)], next_cursor: null },
    };
    const worker = fakeWorker({
      '/v1/lookups': () => lookups,
      '/v1/products': (u) =>
        u.searchParams.get('q') === 'nada'
          ? { items: [], next_cursor: null }
          : pages[u.searchParams.get('cursor') ?? ''],
    });
    renderAt('/catalogo', worker.fetchImpl);
    await screen.findByText('Leche Lala Entera');
    expect(screen.getByText('$26.50/L').parentElement!.textContent).toContain('Anaquel:');
    expect(screen.getByText('1 L en Soriana · hoy')).toBeTruthy();
    expect(screen.getByText('Sin precios en los últimos 90 días')).toBeTruthy();
    expect(screen.getAllByText('Lala · 2 presentaciones')).toHaveLength(2);
    // Subcategories are indented under their parent.
    const options = within(screen.getByLabelText('Categoría'))
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options).toEqual(['Todas las categorías', 'Refrigerados', ' Lácteos']);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Ver más' }));
    await screen.findByText('Leche Deslactosada');
    expect(screen.queryByRole('button', { name: 'Ver más' })).toBeNull();
    await user.selectOptions(screen.getByLabelText('Categoría'), 'c-lacteos');
    await user.selectOptions(screen.getByLabelText('Etiqueta'), 't-basicos');
    await user.type(screen.getByLabelText('Buscar por nombre, marca o código'), 'nada');
    await screen.findByText('Ningún producto coincide con la búsqueda.');
    const last = worker.requests.filter((u) => u.pathname === '/v1/products').at(-1)!;
    expect(Object.fromEntries(last.searchParams)).toEqual({
      limit: '30',
      q: 'nada',
      category_id: 'c-lacteos',
      tag_id: 't-basicos',
    });
  });

  it('says when there are no products at all', async () => {
    renderAt(
      '/catalogo',
      fakeWorker({ '/v1/lookups': () => lookups, '/v1/products': () => ({ items: [], next_cursor: null }) })
        .fetchImpl,
    );
    await screen.findByText('Aún no hay productos. Agrega el primero con "Nuevo producto".');
  });
});

describe('W-08 ficha', () => {
  it('shows the product, its variants and their latest prices', async () => {
    renderAt(
      '/productos/p1',
      fakeWorker({ '/v1/lookups': () => lookups, '/v1/products/p1': () => detail }).fetchImpl,
    );
    await screen.findByRole('heading', { name: 'Leche Lala Entera' });
    expect(screen.getByText('Lala · Refrigerados › Lácteos')).toBeTruthy();
    expect(within(screen.getByRole('list', { name: 'Etiquetas' })).getByText('Básicos')).toBeTruthy();
    expect(screen.getByText('Códigos: 7501020515343')).toBeTruthy();
    expect(screen.getByText('Soriana · Pagado · hace 2 días')).toBeTruthy();
    expect(screen.getByText('A granel: se pesa en la tienda.')).toBeTruthy();
    expect(screen.getByText('Sin precios registrados.')).toBeTruthy();
    // Merging is the admin's.
    expect(screen.queryByRole('link', { name: 'Fusionar con otro producto' })).toBeNull();
  });

  it('compares variants by store and marks the cheapest; other measures go apart', async () => {
    const compare = {
      display_unit: 'L',
      rows: [
        {
          variant_id: 'v1',
          store_id: 's-costco',
          display_unit: 'L',
          last: { display_cents: 2_450, observed_at: NOW, source: 'purchase' },
          min: { display_cents: 2_400, observed_at: NOW },
          avg_display_cents: 2_430,
          n: 3,
        },
        {
          variant_id: 'v1',
          store_id: 's-soriana',
          display_unit: 'L',
          last: { display_cents: 2_850, observed_at: NOW, source: 'shelf' },
          min: { display_cents: 2_850, observed_at: NOW },
          avg_display_cents: 2_850,
          n: 1,
        },
        {
          variant_id: 'v2',
          store_id: 's-soriana',
          display_unit: 'kg',
          last: { display_cents: 9_000, observed_at: NOW, source: 'purchase' },
          min: { display_cents: 9_000, observed_at: NOW },
          avg_display_cents: 9_000,
          n: 1,
        },
      ],
      best: { variant_id: 'v1', store_id: 's-costco' },
    };
    renderAt(
      '/productos/p1?vista=comparar',
      fakeWorker(
        {
          '/v1/lookups': () => lookups,
          '/v1/products/p1': () => detail,
          '/v1/products/p1/compare': () => compare,
        },
        'admin',
      ).fetchImpl,
    );
    const tables = await screen.findAllByRole('table');
    // Only the variants of the product's measure compare.
    expect(within(tables[0]!).getAllByRole('row')).toHaveLength(3);
    const rows = within(tables[0]!)
      .getAllByRole('row')
      .slice(1)
      .map((r) => r.textContent);
    expect(rows[0]).toContain('Más barato');
    expect(rows[0]).toContain('Costco');
    expect(rows[1]).not.toContain('Más barato');
    expect(within(tables[1]!).getAllByRole('row')[1]!.textContent).toContain('A granel (kg)Soriana');
    expect(screen.getByRole('heading', { name: 'Otras medidas (no se comparan)' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Fusionar con otro producto' })).toBeTruthy();
  });

  it('shows the history list newest first and filters it', async () => {
    const points = [
      {
        source: 'purchase',
        point_id: 'a',
        store_id: 's-soriana',
        branch_id: null,
        listing_id: null,
        observed_at: Date.UTC(2026, 8, 1, 18),
        list_unit_cents: 2_900,
        effective_unit_cents: 2_900,
        display_cents: 2_900,
        has_promo: false,
      },
      {
        source: 'shelf',
        point_id: 'b',
        store_id: 's-costco',
        branch_id: null,
        listing_id: null,
        observed_at: Date.UTC(2026, 9, 12, 18),
        list_unit_cents: 2_700,
        effective_unit_cents: 2_450,
        display_cents: 2_450,
        has_promo: true,
      },
    ];
    const worker = fakeWorker({
      '/v1/lookups': () => lookups,
      '/v1/products/p1': () => detail,
      '/v1/variants/v1/history': () => ({
        variant: { id: 'v1', product_name: 'Leche' },
        display_unit: 'L',
        points,
        web_confirmed_until: {},
      }),
    });
    renderAt('/productos/p1?vista=historial', worker.fetchImpl);
    // The chart library loads when the tab opens: slow the first time in jsdom.
    const list = await screen.findByRole('list', { name: 'Precios' }, { timeout: 8000 });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([
      'Anaquel:$24.50/LCostco · 12 oct 2026 · Con promoción',
      'Pagado:$29.00/LSoriana · 1 sep 2026',
    ]);
    expect(screen.getByLabelText(/2 precios del 1 sep 2026 al 12 oct 2026/)).toBeTruthy();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Web'));
    await user.selectOptions(screen.getByLabelText('Tienda'), 's-costco');
    await waitFor(() => {
      const last = worker.requests.filter((u) => u.pathname === '/v1/variants/v1/history').at(-1)!;
      expect([last.searchParams.get('sources'), last.searchParams.get('store_id')]).toEqual([
        'purchase,shelf',
        's-costco',
      ]);
    });
    await user.click(screen.getByLabelText('Pagado'));
    await user.click(screen.getByLabelText('Anaquel'));
    await screen.findByText('Elige al menos una fuente.');
  });

  it('says when the product is gone', async () => {
    renderAt('/productos/zzz', fakeWorker({ '/v1/lookups': () => lookups }).fetchImpl);
    await screen.findByText('Este producto ya no existe; quizá se borró o se fusionó con otro.');
  });
});

describe('describeHistory', () => {
  it('says how many prices, when, and the lowest and highest', () => {
    const p = (at: number, cents: number) => ({
      source: 'purchase' as const,
      point_id: String(at),
      store_id: 's',
      branch_id: null,
      listing_id: null,
      observed_at: at,
      list_unit_cents: cents,
      effective_unit_cents: cents,
      display_cents: cents,
      has_promo: false,
    });
    expect(describeHistory([p(Date.UTC(2026, 9, 1, 18), 2_850)], 'L')).toBe(
      '1 precio del 1 oct 2026; el más bajo $28.50/L y el más alto $28.50/L.',
    );
    expect(
      describeHistory([p(Date.UTC(2026, 9, 1, 18), 2_850), p(Date.UTC(2026, 9, 3, 18), 2_500)], 'kg'),
    ).toBe('2 precios del 1 oct 2026 al 3 oct 2026; el más bajo $25.00/kg y el más alto $28.50/kg.');
  });
});
