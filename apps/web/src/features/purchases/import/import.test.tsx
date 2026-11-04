import type { ImportRequest, ImportResult } from '@maunedas/shared/api/imports';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { lookups } from '../../../test/catalog';
import { fakeWorker, renderAt } from '../../../test/render';

const LAZY = { timeout: 5000 };

const CSV = [
  'Fecha,Tienda,Artículo,Cant.,Precio unitario,Folio',
  '04/11/2026,SORIANA HIPER,Leche Lala 1 L,2,28.50,',
  '04/11/2026,Soriana Híper,Pan blanco,1,45,',
  '05/11/2026,Costco Wholesale,Café,1,"$1,200.00",C-9',
  'mañana,Costco,Algo,1,1,',
  '06/11/2026,La tiendita,Chicles,3,5,',
].join('\n');

/** A Worker that creates each purchase the first time and says "duplicate" after, as `purchase_imports` does. */
function worker(fail?: (request: number) => Response | null) {
  const seen = new Set<string>();
  let requests = 0;
  return fakeWorker({
    '/v1/lookups': () => lookups,
    '/v1/purchases': () => ({ items: [], next_cursor: null }),
    '/v1/purchases/import': (_u, body) => {
      const failed = fail?.(++requests);
      if (failed) return failed;
      const results: ImportResult[] = (body as ImportRequest).purchases.map((p) => {
        const key = JSON.stringify(p);
        const status = seen.has(key) ? 'duplicate' : 'created';
        seen.add(key);
        return {
          purchase_id: `p-${key.length}`,
          status,
          lines: p.lines.length,
          linked: status === 'created' ? 1 : 0,
        };
      });
      return { results };
    },
  });
}

const imports = (w: ReturnType<typeof fakeWorker>) =>
  w.posts.filter((p) => p.path === '/v1/purchases/import').map((p) => p.body as ImportRequest);

async function open(w: ReturnType<typeof fakeWorker>, text = CSV, name = 'compras.csv') {
  renderAt('/compras/importar', w.fetchImpl);
  const ui = userEvent.setup();
  await ui.upload(await screen.findByLabelText('Archivo', undefined, LAZY), new File([text], name));
  return ui;
}

describe('W-03 importar compras de un archivo (T-306)', () => {
  it('guesses the columns, matches the stores, previews and imports drafts', async () => {
    const w = worker();
    const ui = await open(w);
    expect((screen.getByLabelText('Fecha (obligatorio)') as HTMLSelectElement).value).toBe('0');
    expect((screen.getByLabelText('Precio unitario') as HTMLSelectElement).value).toBe('4');
    expect((screen.getByLabelText('Importe de la línea') as HTMLSelectElement).value).toBe('');
    // Stores by name; one the household does not have yet waits for a choice.
    expect((screen.getByLabelText('Tienda para SORIANA HIPER') as HTMLSelectElement).value).toBe('s-soriana');
    expect((screen.getByLabelText('Tienda para Costco Wholesale') as HTMLSelectElement).value).toBe(
      's-costco',
    );
    expect((screen.getByLabelText('Tienda para La tiendita') as HTMLSelectElement).value).toBe('');
    // "Soriana Híper" is another name in the file: its own group.
    expect(screen.getByRole('heading', { name: '4 compras con 4 líneas' })).toBeTruthy();
    expect(screen.getByText('Fila 5: sin fecha válida')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Importar 4 compras' })).toHaveProperty('disabled', true);
    expect(screen.getByText('Elige la tienda de cada compra para importarlas.')).toBeTruthy();

    await ui.selectOptions(screen.getByLabelText('Tienda para La tiendita'), 's-soriana');
    const rows = within(screen.getByRole('table'))
      .getAllByRole('row')
      .slice(1)
      .map((r) => r.textContent);
    expect(rows).toEqual([
      '4 nov 2026Soriana1$57.00',
      '4 nov 2026Soriana1$45.00',
      '5 nov 2026CostcoC-91$1,200.00',
      '6 nov 2026Soriana1$15.00',
    ]);
    await ui.click(screen.getByRole('button', { name: 'Importar 4 compras' }));
    expect((await screen.findByRole('status')).textContent).toBe(
      'Se crearon 4 compras en borrador, con 4 de 4 líneas vinculadas solas.',
    );
    const [sent] = imports(w);
    expect(sent!.file_name).toBe('compras.csv');
    expect(sent!.purchases[0]).toEqual({
      store_id: 's-soriana',
      purchased_at: Date.UTC(2026, 10, 4, 18),
      ticket: null,
      lines: [{ description: 'Leche Lala 1 L', quantity: 2, unit_price_cents: 2_850, final_cents: 5_700 }],
    });
    expect(sent!.purchases[2]).toMatchObject({ store_id: 's-costco', ticket: 'C-9' });
    expect(screen.getByRole('link', { name: 'Ver borradores' }).getAttribute('href')).toBe(
      '/compras?estado=borrador',
    );

    // The same file again creates nothing.
    await ui.click(screen.getByRole('button', { name: 'Importar otro archivo' }));
    await ui.upload(screen.getByLabelText('Archivo'), new File([CSV], 'compras.csv'));
    await ui.selectOptions(screen.getByLabelText('Tienda para La tiendita'), 's-soriana');
    await ui.click(screen.getByRole('button', { name: 'Importar 4 compras' }));
    expect((await screen.findByRole('status')).textContent).toBe(
      'Se crearon 0 compras en borrador. 4 ya estaban importadas.',
    );
  });

  it('without a store column, one store for all; and a file without a header is mapped by hand', async () => {
    const w = worker();
    const ui = await open(w, '2026-11-04;Agua;12,50\n2026-11-04;Hielo;30\n', 'hoja.csv');
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
    expect(
      screen.getByText('Elige las columnas de fecha, descripción y precio unitario o importe.'),
    ).toBeTruthy();
    await ui.selectOptions(screen.getByLabelText('Fecha (obligatorio)'), 'Columna A (ej. 2026-11-04)');
    await ui.selectOptions(screen.getByLabelText('Descripción (obligatorio)'), 'Columna B (ej. Agua)');
    await ui.selectOptions(screen.getByLabelText('Importe de la línea'), 'Columna C (ej. 12,50)');
    expect(screen.getByRole('heading', { name: '1 compra con 2 líneas' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Importar 1 compra' })).toHaveProperty('disabled', true);
    await ui.selectOptions(screen.getByLabelText('Tienda de todas las compras'), 's-costco');
    await ui.click(screen.getByRole('button', { name: 'Importar 1 compra' }));
    expect((await screen.findByRole('status')).textContent).toBe(
      'Se creó 1 compra en borrador, con 1 de 2 líneas vinculadas solas.',
    );
    expect(imports(w)[0]!.purchases[0]!.lines.map((l) => l.final_cents)).toEqual([1_250, 3_000]);
    expect(imports(w)[0]!.purchases[0]!.store_id).toBe('s-costco');
  });

  it('a column can be left out, and the header can be turned on later', async () => {
    const w = worker();
    const ui = await open(w, 'Fecha,Concepto,Monto\n04/11/2026,Agua,10\n', 'a.csv');
    await ui.click(screen.getByRole('checkbox'));
    // As data, the header row has no date.
    await ui.selectOptions(screen.getByLabelText('Tienda de todas las compras'), 's-costco');
    expect(screen.getByText('Fila 1: sin fecha válida')).toBeTruthy();
    await ui.click(screen.getByRole('checkbox'));
    expect(screen.queryByText('Fila 1: sin fecha válida')).toBeNull();
    await ui.selectOptions(screen.getByLabelText('Importe de la línea'), '— Sin columna —');
    expect(screen.queryByRole('button', { name: /Importar/ })).toBeNull();
  });

  it('sends a big file 20 purchases at a time and says what went in when one part fails', async () => {
    const lines = Array.from(
      { length: 25 },
      (_, i) => `${String(i + 1).padStart(2, '0')}/10/2026,Soriana,Cosa ${i},${i + 1}`,
    );
    const w = worker((n) =>
      n === 2
        ? Response.json({ error: { code: 'INTERNAL', message: 'Falló el servidor.' } }, { status: 500 })
        : null,
    );
    const ui = await open(w, ['Fecha,Tienda,Descripción,Importe', ...lines].join('\n'), 'octubre.csv');
    await ui.click(screen.getByRole('button', { name: 'Importar 25 compras' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Falló el servidor. Ya se importaron 20 compras; vuelve a intentarlo y no se repetirán.',
    );
    expect(imports(w).map((r) => r.purchases.length)).toEqual([20, 5]);
    await ui.click(screen.getByRole('button', { name: 'Importar 25 compras' }));
    expect((await screen.findByRole('status')).textContent).toBe(
      'Se crearon 5 compras en borrador, con 5 de 5 líneas vinculadas solas. 20 ya estaban importadas.',
    );
  });

  it('says why a file cannot be read', async () => {
    await open(worker(), 'x', 'viejo.xls');
    expect((await screen.findByRole('alert')).textContent).toContain('.xls antiguos');
  });

  it('an empty file has nothing to import', async () => {
    const w = worker(() => null);
    await open(w, '\n\n', 'vacio.csv');
    expect((await screen.findByRole('alert')).textContent).toBe('El archivo no tiene filas.');
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
});
