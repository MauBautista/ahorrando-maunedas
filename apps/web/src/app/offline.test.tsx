import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { servedFromNetwork } from '../lib/online';
import { STORED_AT } from '../sw/strategies';
import { lookups } from '../test/catalog';
import { fakeWorker, renderAt } from '../test/render';

const LAZY = { timeout: 5000 };

afterEach(() => servedFromNetwork());

describe('the page without network (T-310)', () => {
  it('says the data is what this device kept, and when', async () => {
    // 2026-11-04 10:35 in Mexico City.
    const at = Date.UTC(2026, 10, 4, 16, 35);
    const kept = (body: unknown) =>
      new Response(JSON.stringify(body), {
        headers: { 'Content-Type': 'application/json', [STORED_AT]: String(at) },
      });
    renderAt(
      '/catalogo',
      fakeWorker({
        '/v1/lookups': () => kept(lookups),
        '/v1/products': () => kept({ items: [], next_cursor: null }),
      }).fetchImpl,
    );
    await waitFor(
      () =>
        expect(screen.getByRole('status').textContent).toBe(
          'Sin conexión: ves lo guardado en este dispositivo (4 nov 2026, 10:35 a.m.).',
        ),
      LAZY,
    );
  });

  it('says nothing while the network answers', async () => {
    renderAt(
      '/catalogo',
      fakeWorker({
        '/v1/lookups': () => lookups,
        '/v1/products': () => ({ items: [], next_cursor: null }),
      }).fetchImpl,
    );
    await screen.findByLabelText('Categoría', undefined, LAZY);
    expect(screen.queryByText(/Sin conexión/)).toBeNull();
  });
});
