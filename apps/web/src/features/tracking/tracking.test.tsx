import type { AlertEventItem, AlertRuleItem } from '@maunedas/shared/api/alerts';
import type { ListingWithState } from '@maunedas/shared/api/listings';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { detail } from '../../test/catalog';
import { found } from '../../test/purchases';
import { fakeWorker, renderAt } from '../../test/render';
import { ruleProblem } from './rules';

const LAZY = { timeout: 5000 };
const HOUR = 3_600_000;
const lookups = {
  stores: [
    { id: 's-amazon', name: 'Amazon', kind: 'online' },
    { id: 's-costco', name: 'Costco', kind: 'both' },
  ],
  store_branches: [],
  categories: [],
  tags: [],
};

function listing(o: Partial<ListingWithState> = {}): ListingWithState {
  return {
    id: 'l1',
    variant_id: 'v1',
    store_id: 's-amazon',
    adapter: 'amazon_mx',
    url: 'https://www.amazon.com.mx/Leche/dp/B07XJ8C8F5?ref=x',
    canonical_url: 'https://www.amazon.com.mx/dp/B07XJ8C8F5',
    external_id: 'B07XJ8C8F5',
    check_interval_min: null,
    active: 1,
    created_at: 1,
    updated_at: 1_000,
    version: 3,
    product_id: 'p1',
    product_name: 'Leche Lala Entera',
    brand: 'Lala',
    variant_label: '1 L',
    store_name: 'Amazon',
    state: {
      listing_id: o.id ?? 'l1',
      last_checked_at: Date.now() - 2 * HOUR,
      last_status: 'ok',
      last_error: null,
      consecutive_failures: 0,
      last_price_cents: 2899,
      last_list_price_cents: 3299,
      last_in_stock: 1,
      last_promo_text: '2x1 en la segunda pieza',
      check_requested_at: null,
      updated_at: 1,
      version: 3,
    },
    ...o,
  };
}

const LISTINGS = [
  listing(),
  listing({
    id: 'l2',
    store_id: 's-costco',
    adapter: 'costco_mx',
    store_name: 'Costco',
    check_interval_min: 240,
    state: {
      ...listing().state!,
      listing_id: 'l2',
      last_in_stock: 0,
      last_list_price_cents: null,
      last_promo_text: null,
    },
  }),
  listing({
    id: 'l3',
    variant_id: 'v9',
    product_id: 'p9',
    product_name: 'Atún Dolores',
    variant_label: '140 g',
    store_name: 'Sam’s Club',
    state: {
      ...listing().state!,
      listing_id: 'l3',
      last_status: 'blocked',
      consecutive_failures: 3,
      // A list price below the price is not a struck one.
      last_list_price_cents: 2000,
      last_promo_text: null,
      check_requested_at: Date.now(),
    },
  }),
  listing({
    id: 'l4',
    variant_id: 'v9',
    product_id: 'p9',
    product_name: 'Atún Dolores',
    variant_label: '140 g',
    active: 0,
    state: null,
  }),
];

function worker(
  extra: Record<string, (url: URL, body: unknown) => unknown> = {},
  role: 'admin' | 'member' = 'member',
) {
  return fakeWorker(
    {
      '/v1/lookups': () => lookups,
      '/v1/listings': (url) => ({
        items: url.searchParams.get('variant_id')
          ? LISTINGS.filter((l) => l.variant_id === url.searchParams.get('variant_id'))
          : LISTINGS,
      }),
      '/v1/listings/*': () => new Response(null, { status: 202 }),
      '/v1/sync/push': (_u, body) => ({
        applied: (body as { mutations: unknown[] }).mutations.length,
        skipped: 0,
        conflicts: [],
      }),
      '/v1/products/p1': () => detail,
      '/v1/search/variants': () => ({ items: [found({ product_name: 'Leche Lala Entera', brand: 'Lala' })] }),
      ...extra,
    },
    role,
  );
}

const pushed = (w: ReturnType<typeof worker>) =>
  w.posts
    .filter((p) => p.path === '/v1/sync/push')
    .map((p) => (p.body as { mutations: unknown[] }).mutations);

describe('W-20 seguimiento', () => {
  it('lists the tracked links by variant with price, state and last check', async () => {
    renderAt('/seguimiento', worker().fetchImpl);
    const milk = await screen.findByRole('heading', { name: 'Leche Lala Entera · 1 L' }, LAZY);
    expect(within(milk).getByRole('link').getAttribute('href')).toBe('/productos/p1');
    const cards = screen.getAllByRole('listitem');
    expect(cards).toHaveLength(4);
    const [amazon, costco, sams, paused] = cards as [HTMLElement, HTMLElement, HTMLElement, HTMLElement];
    expect(amazon.textContent).toContain('Al día');
    expect(amazon.textContent).toContain('$28.99');
    expect(within(amazon).getByLabelText('Antes $32.99')).toBeTruthy();
    expect(amazon.textContent).toContain('2x1 en la segunda pieza');
    expect(amazon.textContent).toContain('Revisado hace 2 h');
    expect(costco.textContent).toContain('Agotado');
    expect(costco.textContent).toContain('Último precio visto');
    expect(costco.textContent).toContain('Cada 4 h');
    expect(sams.textContent).toContain('Bloqueado');
    expect(sams.textContent).toContain('se reintentará más tarde');
    expect(within(sams).queryByLabelText(/^Antes/)).toBeNull();
    expect(sams.textContent).toContain('Revisión solicitada');
    expect((within(sams).getByRole('button', { name: 'Revisar ahora' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(paused.textContent).toContain('En pausa');
    expect(paused.textContent).toContain('Aún no se revisa');
    expect(
      (within(paused).getByRole('button', { name: 'Revisar ahora' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(within(paused).getByRole('button', { name: 'Reanudar' })).toBeTruthy();
    expect(within(amazon).getByRole('link', { name: 'Abrir en la tienda' }).getAttribute('href')).toBe(
      'https://www.amazon.com.mx/Leche/dp/B07XJ8C8F5?ref=x',
    );
    // Inside Catálogo, as on Android.
    expect(
      within(screen.getByRole('navigation', { name: 'Catálogo' })).getByRole('link', { name: 'Seguimiento' }),
    ).toBeTruthy();
  });

  it('asks for a check now, pauses and stops following by sync', async () => {
    const w = worker();
    renderAt('/seguimiento', w.fetchImpl);
    const ui = userEvent.setup();
    await screen.findByRole('heading', { name: 'Leche Lala Entera · 1 L' }, LAZY);
    const amazon = screen.getAllByRole('listitem')[0]!;
    await ui.click(within(amazon).getByRole('button', { name: 'Revisar ahora' }));
    expect((await screen.findByRole('status')).textContent).toBe(
      'El servidor casero revisará Amazon en unos minutos.',
    );
    expect(w.posts.some((p) => p.path === '/v1/listings/l1/check-now' && p.method === 'POST')).toBe(true);

    await ui.click(within(amazon).getByRole('button', { name: 'Pausar' }));
    await ui.click(within(screen.getAllByRole('listitem')[3]!).getByRole('button', { name: 'Reanudar' }));
    await ui.click(
      within(screen.getAllByRole('listitem')[1]!).getByRole('button', { name: 'Dejar de seguir' }),
    );
    const confirm = within(screen.getByRole('dialog', { name: '¿Dejar de seguir este enlace?' }));
    expect(confirm.getByText(/Costco · Leche Lala Entera · 1 L/)).toBeTruthy();
    await ui.click(confirm.getByRole('button', { name: 'Dejar de seguir' }));
    await screen.findByRole('heading', { name: 'Atún Dolores · 140 g' });
    const rows = pushed(w).map((m) => (m as Array<{ table: string; row: Record<string, unknown> }>)[0]!);
    expect(rows.map((r) => r.table)).toEqual(['listings', 'listings', 'listings']);
    expect(rows[0]!.row).toEqual({ id: 'l1', updated_at: expect.any(Number), active: 0 });
    expect(rows[0]!.row.updated_at as number).toBeGreaterThan(1_000);
    expect(rows[1]!.row).toMatchObject({ id: 'l4', active: 1 });
    expect(rows[2]!.row).toEqual({
      id: 'l2',
      updated_at: expect.any(Number),
      deleted_at: expect.any(Number),
    });
  });

  it('follows a new link after resolving it and choosing the variant', async () => {
    let answer: Response | object = Response.json(
      {
        error: {
          code: 'UNSUPPORTED_URL',
          message: 'Esa tienda todavía no se puede seguir.',
          details: { reason: 'NOT_TRACKED' },
        },
      },
      { status: 422 },
    );
    const w = worker({ '/v1/listings/resolve': () => answer });
    renderAt('/seguimiento', w.fetchImpl);
    const ui = userEvent.setup();
    await ui.click(await screen.findByRole('button', { name: 'Seguir un enlace' }, LAZY));
    const dialog = within(screen.getByRole('dialog', { name: 'Seguir un enlace' }));
    await ui.type(dialog.getByLabelText('Enlace del producto'), 'Mira https://www.walmart.com.mx/ip/x/1');
    await ui.click(dialog.getByRole('button', { name: 'Continuar' }));
    expect((await dialog.findByRole('alert')).textContent).toContain(
      'solo productos de Amazon, Sam’s Club y Costco',
    );

    answer = {
      adapter: 'costco_mx',
      store_id: 's-costco',
      url: 'https://www.costco.com.mx/p/668241?x=1',
      canonical_url: 'https://www.costco.com.mx/p/668241',
      external_id: '668241',
    };
    await ui.click(dialog.getByRole('button', { name: 'Continuar' }));
    expect(await dialog.findByText('Costco')).toBeTruthy();
    expect(dialog.getByText('https://www.costco.com.mx/p/668241')).toBeTruthy();
    const save = dialog.getByRole('button', { name: 'Seguir precio' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await ui.type(dialog.getByLabelText('Buscar presentación'), 'leche');
    await ui.click(await dialog.findByRole('button', { name: /Leche Lala Entera · 1 L/ }));
    await ui.click(save);
    expect((await screen.findByRole('status')).textContent).toBe(
      'Listo. El servidor casero lo revisará en unos minutos.',
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(w.posts.find((p) => p.path === '/v1/listings/resolve')!.body).toEqual({
      url: 'Mira https://www.walmart.com.mx/ip/x/1',
    });
    const row = (pushed(w)[0] as Array<{ table: string; row: Record<string, unknown> }>)[0];
    expect(row).toEqual({
      table: 'listings',
      row: {
        id: expect.any(String),
        created_at: expect.any(Number),
        updated_at: expect.any(Number),
        deleted_at: null,
        variant_id: 'v1',
        store_id: 's-costco',
        adapter: 'costco_mx',
        url: 'https://www.costco.com.mx/p/668241?x=1',
        canonical_url: 'https://www.costco.com.mx/p/668241',
        external_id: '668241',
        check_interval_min: null,
        active: 1,
      },
    });
  });

  it('refuses a link already followed, and starts from the product page’s variant', async () => {
    const w = worker({
      '/v1/listings/resolve': () => ({
        adapter: 'amazon_mx',
        store_id: 's-amazon',
        url: 'https://amzn.to/x',
        canonical_url: 'https://www.amazon.com.mx/dp/B07XJ8C8F5',
        external_id: 'B07XJ8C8F5',
      }),
    });
    renderAt('/seguimiento?producto=p1&variante=v1', w.fetchImpl);
    const ui = userEvent.setup();
    expect((await screen.findByText(/^Solo Leche Lala Entera · 1 L\./, {}, LAZY)).textContent).toContain(
      'Ver todo',
    );
    expect(
      w.requests.some((u) => u.pathname === '/v1/listings' && u.searchParams.get('variant_id') === 'v1'),
    ).toBe(true);
    expect(screen.queryByText('Atún Dolores · 140 g')).toBeNull();
    await ui.click(screen.getByRole('button', { name: 'Seguir un enlace' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Seguir un enlace' }));
    await ui.type(dialog.getByLabelText('Enlace del producto'), 'https://amzn.to/x');
    await ui.click(dialog.getByRole('button', { name: 'Continuar' }));
    expect((await dialog.findByRole('alert')).textContent).toBe(
      'Ese enlace ya está en seguimiento para Leche Lala Entera · 1 L.',
    );
    expect((dialog.getByRole('button', { name: 'Seguir precio' }) as HTMLButtonElement).disabled).toBe(true);
    await ui.click(dialog.getByRole('button', { name: 'Otro enlace' }));
    expect(dialog.getByLabelText('Enlace del producto')).toBeTruthy();
  });

  it('says when nothing is followed yet', async () => {
    renderAt('/seguimiento', worker({ '/v1/listings': () => ({ items: [] }) }).fetchImpl);
    expect(await screen.findByText(/Aún no sigues ningún precio en línea/, {}, LAZY)).toBeTruthy();
  });
});

function rule(o: Partial<AlertRuleItem> = {}): AlertRuleItem {
  return {
    id: 'r1',
    user_id: 'u1',
    variant_id: 'v1',
    listing_id: null,
    type: 'below_price',
    threshold_cents: 2500,
    threshold_pct: null,
    scope: 'variant_web',
    cooldown_hours: 24,
    active: 1,
    created_at: 1,
    updated_at: 1_000,
    deleted_at: null,
    version: 1,
    product_id: 'p1',
    product_name: 'Leche Lala Entera',
    brand: 'Lala',
    variant_label: '1 L',
    store_name: null,
    ...o,
  };
}

function event(i: number, o: Partial<AlertEventItem> = {}): AlertEventItem {
  return {
    id: `e${i}`,
    rule_id: 'r1',
    user_id: 'u1',
    observation_id: null,
    fired_at: Date.parse('2026-10-31T20:05:00Z') - i * HOUR,
    title: `Leche Lala Entera · 1 L bajó a $24.${i}0`,
    body: 'En Amazon. Tu objetivo: $25.00.',
    delivery_status: 'sent',
    version: 1,
    variant_id: 'v1',
    product_id: 'p1',
    product_name: 'Leche Lala Entera',
    brand: 'Lala',
    variant_label: '1 L',
    ...o,
  };
}

function alertsWorker() {
  return worker({
    '/v1/alerts/rules': (url) => ({
      items: url.searchParams.get('variant_id')
        ? [rule()]
        : [
            rule(),
            rule({
              id: 'r2',
              type: 'drop_pct',
              threshold_cents: null,
              threshold_pct: 10,
              listing_id: 'l2',
              store_name: 'Costco',
              active: 0,
              cooldown_hours: 0,
            }),
            rule({ id: 'r3', type: 'new_low', threshold_cents: null, scope: 'variant_all' }),
          ],
    }),
    '/v1/alerts/events': (url) =>
      url.searchParams.get('cursor')
        ? {
            items: [event(2, { delivery_status: 'no_devices', product_id: null, variant_id: null })],
            next_cursor: null,
          }
        : { items: [event(0), event(1, { delivery_status: 'partial' })], next_cursor: 'c1' },
  });
}

describe('W-21 alertas', () => {
  it('lists my rules and the alerts that fired, and pages the history', async () => {
    renderAt('/alertas', alertsWorker().fetchImpl);
    const ui = userEvent.setup();
    const rules = within(await screen.findByRole('region', { name: 'Mis alertas' }, LAZY));
    const [below, drop, low] = (await rules.findAllByRole('listitem')) as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
    ];
    expect(below.textContent).toContain('Si baja a $25.00 o menos');
    expect(below.textContent).toContain('Cualquier tienda que sigas · Silencio de 24 h');
    expect(drop.textContent).toContain('Si baja 10 % o más de una revisión a otra');
    expect(drop.textContent).toContain('Solo Costco · En pausa');
    expect(within(drop).getByRole('button', { name: 'Activar' })).toBeTruthy();
    expect(low.textContent).toContain('precio más bajo registrado (compras, anaquel y en línea)');

    const history = within(screen.getByRole('region', { name: 'Historial' }));
    const fired = await history.findAllByRole('listitem');
    expect(fired[0]!.textContent).toContain('Leche Lala Entera · 1 L bajó a $24.00');
    expect(fired[0]!.textContent).toContain('31 oct 2026, 14:05 · Notificación enviada');
    expect(within(fired[0]!).getByRole('link', { name: 'Ver producto' }).getAttribute('href')).toBe(
      '/productos/p1',
    );
    expect(fired[1]!.textContent).toContain('Enviada a algunos teléfonos');
    await ui.click(history.getByRole('button', { name: 'Ver más' }));
    const all = await history.findAllByRole('listitem');
    await screen.findByText(/Sin teléfono registrado/);
    expect(history.getAllByRole('listitem')).toHaveLength(3);
    expect(all.length).toBeGreaterThanOrEqual(2);
    expect(within(history.getAllByRole('listitem')[2]!).queryByRole('link')).toBeNull();
    expect(history.queryByRole('button', { name: 'Ver más' })).toBeNull();
  });

  it('creates a rule after saying what is missing, for the product page’s variant', async () => {
    const w = alertsWorker();
    renderAt('/alertas?producto=p1&variante=v1', w.fetchImpl);
    const ui = userEvent.setup();
    await screen.findByText(/^Solo Leche Lala Entera · 1 L\./, {}, LAZY);
    await ui.click(screen.getByRole('button', { name: 'Nueva alerta' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Nueva alerta' }));
    expect(dialog.getByText('Leche Lala Entera · 1 L')).toBeTruthy();
    await ui.click(dialog.getByRole('button', { name: 'Guardar' }));
    expect(dialog.getByRole('alert').textContent).toBe('Escribe el precio objetivo, por ejemplo 25.50.');
    await ui.type(dialog.getByLabelText('Precio objetivo (MXN)'), '24.90');
    await ui.selectOptions(
      await dialog.findByLabelText('Tienda'),
      await dialog.findByRole('option', { name: 'Solo Costco' }),
    );
    await ui.clear(dialog.getByLabelText('Silencio después de avisar (horas)'));
    await ui.type(dialog.getByLabelText('Silencio después de avisar (horas)'), '12');
    await ui.click(dialog.getByRole('button', { name: 'Guardar' }));
    await screen.findByRole('region', { name: 'Mis alertas' });
    expect(screen.queryByRole('dialog')).toBeNull();
    const row = (pushed(w)[0] as Array<{ table: string; row: Record<string, unknown> }>)[0];
    expect(row).toEqual({
      table: 'alert_rules',
      row: {
        id: expect.any(String),
        created_at: expect.any(Number),
        updated_at: expect.any(Number),
        deleted_at: null,
        user_id: 'u1',
        variant_id: 'v1',
        listing_id: 'l2',
        type: 'below_price',
        threshold_cents: 2490,
        threshold_pct: null,
        scope: 'variant_web',
        cooldown_hours: 12,
        active: 1,
      },
    });
  });

  it('edits, pauses and removes a rule', async () => {
    const w = alertsWorker();
    renderAt('/alertas', w.fetchImpl);
    const ui = userEvent.setup();
    const rules = within(await screen.findByRole('region', { name: 'Mis alertas' }, LAZY));
    const [below, drop] = (await rules.findAllByRole('listitem')) as [HTMLElement, HTMLElement];
    await ui.click(within(drop).getByRole('button', { name: 'Editar' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Editar alerta' }));
    expect((dialog.getByLabelText('Porcentaje de baja') as HTMLInputElement).value).toBe('10');
    await ui.click(dialog.getByLabelText('Precio más bajo registrado'));
    await ui.selectOptions(dialog.getByLabelText('Comparar'), 'variant_all');
    await ui.click(dialog.getByLabelText('Activa'));
    await ui.click(dialog.getByRole('button', { name: 'Guardar' }));
    // A price rule turned into a percentage one keeps no price, and "any store" is no listing.
    await ui.click(within(below).getByRole('button', { name: 'Editar' }));
    const other = within(screen.getByRole('dialog', { name: 'Editar alerta' }));
    await ui.click(other.getByLabelText('Baja un porcentaje'));
    await ui.clear(other.getByLabelText('Porcentaje de baja'));
    await ui.type(other.getByLabelText('Porcentaje de baja'), '15');
    await ui.click(other.getByRole('button', { name: 'Guardar' }));
    await ui.click(within(below).getByRole('button', { name: 'Pausar' }));
    await ui.click(within(below).getByRole('button', { name: 'Quitar' }));
    await ui.click(
      within(screen.getByRole('dialog', { name: '¿Quitar esta alerta?' })).getByRole('button', {
        name: 'Quitar',
      }),
    );
    await screen.findByRole('region', { name: 'Mis alertas' });
    const rows = pushed(w).map((m) => (m as Array<{ row: Record<string, unknown> }>)[0]!.row);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({
      id: 'r2',
      type: 'new_low',
      scope: 'variant_all',
      threshold_cents: null,
      threshold_pct: null,
      listing_id: 'l2',
      cooldown_hours: 0,
      active: 1,
    });
    expect(rows[1]).toMatchObject({
      id: 'r1',
      type: 'drop_pct',
      threshold_cents: null,
      threshold_pct: 15,
      listing_id: null,
      scope: 'variant_web',
    });
    expect(rows[2]).toEqual({ id: 'r1', updated_at: expect.any(Number), active: 0 });
    expect(rows[3]).toEqual({ id: 'r1', updated_at: expect.any(Number), deleted_at: expect.any(Number) });
  });

  it('checks a rule before writing it', () => {
    const variant = { variant_id: 'v1', product_id: 'p1', product_name: 'Leche', variant_label: '1 L' };
    const base = { variant, type: 'below_price' as const, price: '25', pct: '10', cooldown: '24' };
    expect(ruleProblem(base)).toBeNull();
    expect(ruleProblem({ ...base, variant: null })).toBe('Elige la presentación.');
    expect(ruleProblem({ ...base, price: '0' })).toMatch(/precio objetivo/);
    expect(ruleProblem({ ...base, type: 'drop_pct', pct: '0' })).toBe('El porcentaje va de 1 a 100.');
    expect(ruleProblem({ ...base, type: 'drop_pct', pct: '100' })).toBeNull();
    expect(ruleProblem({ ...base, type: 'drop_pct', pct: '101' })).toBe('El porcentaje va de 1 a 100.');
    expect(ruleProblem({ ...base, cooldown: '721' })).toBe('El silencio va de 0 a 720 horas.');
    expect(ruleProblem({ ...base, cooldown: '1.5' })).toBe('El silencio va de 0 a 720 horas.');
    expect(ruleProblem({ ...base, cooldown: '0' })).toBeNull();
    expect(ruleProblem({ ...base, type: 'promo', price: '' })).toBeNull();
  });
});

describe('W-22 servidor casero', () => {
  const agent = (o: object) => worker({ '/v1/admin/agent': () => o }, 'admin');

  it('shows whether it reports, what is pending, its backups and its errors', async () => {
    renderAt(
      '/admin/agente',
      agent({
        status: {
          id: 'home',
          last_heartbeat_at: Date.now() - 30_000,
          agent_version: '0.1.0',
          info: {
            outbox: 2,
            due: 5,
            mem_mb: 50.9,
            load1: 0.4,
            blocked: ['sams_mx'],
            last_error: 'work: HTTP 503',
            backup: {
              mirror_ok: true,
              mirror_at: Date.parse('2026-11-01T09:00:00Z'),
              mirror_rows: 57,
              dump_ok: true,
              dump_at: Date.parse('2026-11-01T09:00:00Z'),
              dump_file: 'maunedas-2026-11-01.sql.gz',
              dump_bytes: 7389,
              photos_ok: null,
              photos_error: 'sin credenciales de R2',
            },
          },
          updated_at: 1,
          version: 1,
        },
        online: true,
        blocked_listings: 1,
        failing_listings: 2,
        queued_image_jobs: 0,
      }).fetchImpl,
    );
    expect(await screen.findByText('En línea', {}, LAZY)).toBeTruthy();
    expect(screen.getByText(/Último reporte hace un momento .* · versión 0\.1\.0/)).toBeTruthy();
    const text = document.body.textContent!;
    for (const part of [
      'Enlaces por revisar5',
      'Resultados por enviar2',
      'Enlaces bloqueados1',
      'Enlaces con fallas2',
      'Tiendas bloqueandoSam’s Club',
      'Memoria51 MB',
      'Último errorwork: HTTP 503',
      'Copia diaria de la base57 filas al día · 1 nov 2026, 03:00',
      'Volcado semanalmaunedas-2026-11-01.sql.gz (7 KB) · 1 nov 2026, 03:00',
      'Fotossin credenciales de R2',
    ])
      expect(text).toContain(part);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(
      within(screen.getByRole('navigation', { name: 'Administración' })).getByRole('link', {
        name: 'Servidor casero',
      }),
    ).toBeTruthy();
  });

  it('warns when it stopped reporting, and says when it never connected', async () => {
    renderAt(
      '/admin/agente',
      agent({
        status: {
          id: 'home',
          last_heartbeat_at: Date.now() - 3 * HOUR,
          agent_version: '0.1.0',
          info: { backup: { mirror_ok: false, mirror_error: 'HTTP 503' } },
          updated_at: 1,
          version: 1,
        },
        online: false,
        blocked_listings: 0,
        failing_listings: 0,
        queued_image_jobs: 0,
      }).fetchImpl,
    );
    expect(await screen.findByText('Sin conexión', {}, LAZY)).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('los precios en línea no se revisan');
    expect(document.body.textContent).toContain('Falló: HTTP 503');
    expect(document.body.textContent).toContain('Tiendas bloqueandoNinguna');
    expect(document.body.textContent).toContain('Último errorNinguno');
  });

  it('says when the home server never connected', async () => {
    renderAt(
      '/admin/agente',
      agent({ status: null, online: false, blocked_listings: 0, failing_listings: 0, queued_image_jobs: 0 })
        .fetchImpl,
    );
    expect(await screen.findByText('El servidor casero todavía no se ha conectado.', {}, LAZY)).toBeTruthy();
  });
});

describe('the product page links each variant to its tracking and alerts', () => {
  it('opens them for that variant', async () => {
    renderAt('/productos/p1', worker().fetchImpl);
    const links = await screen.findAllByRole('link', { name: 'Precios en línea' }, LAZY);
    expect(links[0]!.getAttribute('href')).toBe('/seguimiento?producto=p1&variante=v1');
    expect(screen.getAllByRole('link', { name: 'Alertas' })[0]!.getAttribute('href')).toBe(
      '/alertas?producto=p1&variante=v1',
    );
  });
});
