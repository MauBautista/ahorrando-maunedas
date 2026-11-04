import { IMPORT_MAX_PURCHASES, type ImportPurchase, type ImportResponse } from '@maunedas/shared/api/imports';
import {
  guessMapping,
  tablePurchases,
  type Cell,
  type ImportField,
  type Mapping,
  type SkipReason,
} from '@maunedas/shared/imports/table';
import { matchStoreName } from '@maunedas/shared/receipts/stores';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useApi } from '../../../lib/context';
import { formatDate, formatMoney } from '../../../lib/format';
import { useLookups } from '../../../lib/lookups';
import { readTable } from './readFile';

const FIELDS: ReadonlyArray<{ key: ImportField; label: string; required?: boolean }> = [
  { key: 'date', label: 'Fecha', required: true },
  { key: 'description', label: 'Descripción', required: true },
  { key: 'amount', label: 'Importe de la línea' },
  { key: 'unit_price', label: 'Precio unitario' },
  { key: 'quantity', label: 'Cantidad' },
  { key: 'store', label: 'Tienda' },
  { key: 'ticket', label: 'Folio o ticket' },
];

const SKIP_TEXT: Record<SkipReason, string> = {
  NO_DATE: 'sin fecha válida',
  NO_DESCRIPTION: 'sin descripción',
  NO_PRICE: 'sin precio ni importe válido',
  BAD_QUANTITY: 'cantidad no válida',
  TOO_MANY_LINES: 'su compra pasa de 300 líneas',
};
const SHOWN_SKIPS = 20;

/** "A", "B", … "AA": how a spreadsheet names its columns. */
function letter(n: number): string {
  let s = '';
  for (let i = n + 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
}

interface Table {
  name: string;
  rows: Cell[][];
}

interface Outcome {
  created: number;
  duplicates: number;
  lines: number;
  linked: number;
}

/**
 * W-03 "Importar archivo" (T-306, 03 §15): a spreadsheet's rows become draft purchases. The file is read here, its
 * columns are mapped (guessed from the header), each store name is matched to a store, and the purchases go to the
 * Worker 20 at a time. Importing the same file again creates nothing new.
 */
export function ImportPurchasesPage() {
  const api = useApi();
  const queryClient = useQueryClient();
  const { data: lookups } = useLookups();
  const stores = useMemo(() => lookups?.stores ?? [], [lookups]);
  const [table, setTable] = useState<Table | null>(null);
  const [header, setHeader] = useState(true);
  const [mapping, setMapping] = useState<Mapping>({});
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [fixedStore, setFixedStore] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  async function read(file: File | undefined) {
    setTable(null);
    setOutcome(null);
    setProblem(null);
    if (!file) return;
    try {
      const rows = await readTable(file);
      if (rows.length === 0) throw new Error('El archivo no tiene filas.');
      const guess = guessMapping(rows[0]!);
      const named = Object.keys(guess).length >= 2;
      setTable({ name: file.name, rows });
      setHeader(named);
      setMapping(named ? guess : {});
      setChosen({});
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'No se pudo leer el archivo.');
    }
  }

  const ready =
    mapping.date !== undefined &&
    mapping.description !== undefined &&
    (mapping.amount !== undefined || mapping.unit_price !== undefined);
  const result = useMemo(
    () =>
      table && ready
        ? tablePurchases(header ? table.rows.slice(1) : table.rows, mapping, header ? 2 : 1)
        : null,
    [table, header, mapping, ready],
  );
  const names = useMemo(
    () => [...new Set((result?.purchases ?? []).map((p) => p.store).filter((s): s is string => s !== null))],
    [result],
  );
  const storeOf = (name: string | null) =>
    name === null ? fixedStore : (chosen[name] ?? matchStoreName(name, stores) ?? '');
  const missingStore = (result?.purchases ?? []).some((p) => !storeOf(p.store));
  const columns = (table?.rows[0] ?? []).map((first, i) => {
    const sample = String(first ?? '').trim();
    return header && sample ? sample : `Columna ${letter(i)}${sample ? ` (ej. ${sample.slice(0, 24)})` : ''}`;
  });
  const width = Math.max(0, ...(table?.rows.map((r) => r.length) ?? []));
  while (columns.length < width) columns.push(`Columna ${letter(columns.length)}`);

  async function importIt() {
    if (!table || !result) return;
    setBusy(true);
    setProblem(null);
    const total: Outcome = { created: 0, duplicates: 0, lines: 0, linked: 0 };
    const purchases: ImportPurchase[] = result.purchases.map((p) => ({
      store_id: storeOf(p.store),
      purchased_at: p.purchased_at,
      ticket: p.ticket,
      lines: p.lines.map(({ row: _, ...line }) => line),
    }));
    try {
      for (let i = 0; i < purchases.length; i += IMPORT_MAX_PURCHASES) {
        const res = await api.post<ImportResponse>('/v1/purchases/import', {
          file_name: table.name.slice(0, 200),
          purchases: purchases.slice(i, i + IMPORT_MAX_PURCHASES),
        });
        for (const r of res.results) {
          if (r.status === 'created') {
            total.created++;
            total.lines += r.lines;
            total.linked += r.linked;
          } else total.duplicates++;
        }
      }
      setOutcome(total);
    } catch (e) {
      // What went in before stays; importing again skips it.
      const done = total.created + total.duplicates;
      setProblem(
        `${e instanceof Error ? e.message : 'No se pudo importar.'}${done > 0 ? ` Ya se importaron ${done} compras; vuelve a intentarlo y no se repetirán.` : ''}`,
      );
    } finally {
      setBusy(false);
      await queryClient.invalidateQueries({ queryKey: ['purchases'] });
    }
  }

  if (outcome) {
    return (
      <section className="flex flex-col gap-4">
        <h1 className="text-title">Importar compras</h1>
        <p role="status">
          {outcome.created === 1 ? 'Se creó 1 compra' : `Se crearon ${outcome.created} compras`} en borrador
          {outcome.lines > 0 && `, con ${outcome.linked} de ${outcome.lines} líneas vinculadas solas`}.
          {outcome.duplicates > 0 &&
            ` ${outcome.duplicates === 1 ? '1 ya estaba importada' : `${outcome.duplicates} ya estaban importadas`}.`}
        </p>
        <p className="text-on-surface-variant">
          Revisa cada borrador para vincular sus líneas y confirmarlo.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link to="/compras?estado=borrador" className="btn-primary inline-flex items-center">
            Ver borradores
          </Link>
          <button type="button" className="btn-outline" onClick={() => setOutcome(null)}>
            Importar otro archivo
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-title">Importar compras</h1>
      <p className="text-on-surface-variant">
        Un archivo de Excel (.xlsx, su primera hoja) o CSV con una línea de compra por fila: fecha,
        descripción y precio o importe; si los trae, cantidad, tienda y folio. Las compras quedan en borrador
        para revisarlas.
      </p>
      <label className="flex flex-col gap-1 text-label">
        Archivo
        <input
          type="file"
          accept=".csv,.tsv,.txt,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => read(e.target.files?.[0])}
        />
      </label>
      {problem && (
        <p role="alert" className="text-error">
          {problem}
        </p>
      )}
      {table && (
        <>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={header}
              onChange={(e) => {
                setHeader(e.target.checked);
                if (e.target.checked && Object.keys(mapping).length === 0)
                  setMapping(guessMapping(table.rows[0]!));
              }}
            />
            La primera fila trae los nombres de las columnas
          </label>
          <fieldset className="grid gap-3 md:grid-cols-2">
            <legend className="mb-2 text-label">¿Qué columna es cada dato?</legend>
            {FIELDS.map((f) => (
              <label key={f.key} className="flex flex-col gap-1 text-label">
                {f.label}
                {f.required ? ' (obligatorio)' : ''}
                <select
                  className="field"
                  value={mapping[f.key] ?? ''}
                  onChange={(e) =>
                    setMapping((m) => {
                      const next = { ...m };
                      if (e.target.value === '') delete next[f.key];
                      else next[f.key] = Number(e.target.value);
                      return next;
                    })
                  }
                >
                  <option value="">— Sin columna —</option>
                  {columns.map((c, i) => (
                    <option key={i} value={i}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </fieldset>
          {!ready && (
            <p role="status" className="text-on-surface-variant">
              Elige las columnas de fecha, descripción y precio unitario o importe.
            </p>
          )}
          {result && (
            <>
              {mapping.store === undefined ? (
                <label className="flex flex-col gap-1 text-label">
                  Tienda de todas las compras
                  <select
                    className="field"
                    value={fixedStore}
                    onChange={(e) => setFixedStore(e.target.value)}
                  >
                    <option value="">Elige la tienda</option>
                    {stores.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                names.length > 0 && (
                  <fieldset className="flex flex-col gap-2">
                    <legend className="mb-2 text-label">Tiendas del archivo</legend>
                    {names.map((name) => (
                      <label
                        key={name}
                        className="flex flex-col gap-1 text-label md:flex-row md:items-center"
                      >
                        <span className="md:w-48">{name}</span>
                        <select
                          aria-label={`Tienda para ${name}`}
                          className="field"
                          value={storeOf(name)}
                          onChange={(e) => setChosen((c) => ({ ...c, [name]: e.target.value }))}
                        >
                          <option value="">Elige la tienda</option>
                          {stores.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </fieldset>
                )
              )}
              {result.purchases.some((p) => p.store === null) && mapping.store !== undefined && (
                <label className="flex flex-col gap-1 text-label">
                  Tienda de las filas sin tienda
                  <select
                    className="field"
                    value={fixedStore}
                    onChange={(e) => setFixedStore(e.target.value)}
                  >
                    <option value="">Elige la tienda</option>
                    {stores.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <h2 className="text-label">
                {result.purchases.length === 1 ? '1 compra' : `${result.purchases.length} compras`} con{' '}
                {result.purchases.reduce((n, p) => n + p.lines.length, 0)} líneas
              </h2>
              {result.purchases.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="text-label text-on-surface-variant">
                        <th className="py-1 pr-3">Fecha</th>
                        <th className="py-1 pr-3">Tienda</th>
                        <th className="py-1 pr-3">Folio</th>
                        <th className="py-1 pr-3 text-right">Líneas</th>
                        <th className="py-1 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.purchases.map((p) => (
                        <tr key={`${p.store}|${p.ticket ?? p.day}`} className="border-t border-outline/20">
                          <td className="py-1 pr-3">{formatDate(p.purchased_at)}</td>
                          <td className="py-1 pr-3">
                            {stores.find((s) => s.id === storeOf(p.store))?.name ?? p.store ?? '—'}
                          </td>
                          <td className="py-1 pr-3">{p.ticket ?? ''}</td>
                          <td className="py-1 pr-3 text-right">{p.lines.length}</td>
                          <td className="py-1 text-right">{formatMoney(p.total_cents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {result.skipped.length > 0 && (
                <div className="flex flex-col gap-1">
                  <p className="text-label">
                    {result.skipped.length === 1
                      ? 'Se omite 1 fila:'
                      : `Se omiten ${result.skipped.length} filas:`}
                  </p>
                  <ul className="list-disc pl-6 text-on-surface-variant">
                    {result.skipped.slice(0, SHOWN_SKIPS).map((s) => (
                      <li key={s.row}>
                        Fila {s.row}: {SKIP_TEXT[s.reason]}
                      </li>
                    ))}
                    {result.skipped.length > SHOWN_SKIPS && (
                      <li>y {result.skipped.length - SHOWN_SKIPS} más</li>
                    )}
                  </ul>
                </div>
              )}
              {missingStore && (
                <p role="status" className="text-on-surface-variant">
                  Elige la tienda de cada compra para importarlas.
                </p>
              )}
              <button
                type="button"
                className="btn-primary self-start"
                disabled={busy || missingStore || result.purchases.length === 0}
                onClick={importIt}
              >
                {busy
                  ? 'Importando…'
                  : result.purchases.length === 1
                    ? 'Importar 1 compra'
                    : `Importar ${result.purchases.length} compras`}
              </button>
            </>
          )}
        </>
      )}
      <Link to="/compras" className="btn-text self-start">
        Volver a compras
      </Link>
    </section>
  );
}
