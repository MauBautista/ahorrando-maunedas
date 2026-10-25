import type { PurchasesResponse } from '@maunedas/shared/api/purchases';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useApi } from '../../lib/context';
import { dateKey, dayTitle } from '../../lib/dates';
import { useLookups } from '../../lib/lookups';
import { PERIODS, periodRange } from './periods';
import { PurchaseItem } from './PurchaseItem';

/**
 * W-03 (05 §5 S-03): the household's purchases by day of Mexico City, newest first, with filters by store, dates and
 * status in the URL.
 */
export function PurchasesPage() {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const store = params.get('tienda') ?? '';
  const period = params.get('periodo') ?? '';
  const status = params.get('estado') ?? '';
  const fromDay = params.get('desde') ?? '';
  const toDay = params.get('hasta') ?? '';
  const { data: lookups } = useLookups();
  // The periods are counted from when the page opened, so the query does not change under the list.
  const [opened] = useState(() => Date.now());
  const range = periodRange(period, opened, fromDay, toDay);
  const badRange = range.from !== undefined && range.to !== undefined && range.from > range.to;

  const purchases = useInfiniteQuery({
    queryKey: ['purchases', store, range.from, range.to, status],
    enabled: !badRange,
    queryFn: ({ pageParam }) => {
      const query = new URLSearchParams({ limit: '30' });
      if (store) query.set('store_id', store);
      if (range.from !== undefined) query.set('from', String(range.from));
      if (range.to !== undefined) query.set('to', String(range.to));
      if (status) query.set('status', status === 'borrador' ? 'draft' : 'confirmed');
      if (pageParam) query.set('cursor', pageParam);
      return api.get<PurchasesResponse>(`/v1/purchases?${query}`);
    },
    initialPageParam: '',
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });

  const set = (key: string, value: string) =>
    setParams(
      (p) => {
        if (value) p.set(key, value);
        else p.delete(key);
        return p;
      },
      { replace: true },
    );
  const items = purchases.data?.pages.flatMap((p) => p.items) ?? [];
  const days: Array<{ key: string; title: string; items: typeof items }> = [];
  for (const p of items) {
    const key = dateKey(p.purchased_at);
    if (days.at(-1)?.key !== key) days.push({ key, title: dayTitle(p.purchased_at, opened), items: [] });
    days.at(-1)!.items.push(p);
  }
  const filtered = !!(store || period || status);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-title">Compras</h1>
        <Link to="/compras/nueva" className="btn-primary inline-flex items-center">
          Nueva compra
        </Link>
      </div>
      <div className="flex flex-col gap-3 md:flex-row md:flex-wrap">
        <select
          aria-label="Tienda"
          value={store}
          onChange={(e) => set('tienda', e.target.value)}
          className="field"
        >
          <option value="">Todas las tiendas</option>
          {(lookups?.stores ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Fechas"
          value={period}
          onChange={(e) => set('periodo', e.target.value)}
          className="field"
        >
          {PERIODS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        {period === 'fechas' && (
          <>
            <label className="flex items-center gap-2">
              Desde
              <input
                type="date"
                value={fromDay}
                onChange={(e) => set('desde', e.target.value)}
                className="field"
              />
            </label>
            <label className="flex items-center gap-2">
              Hasta
              <input
                type="date"
                value={toDay}
                onChange={(e) => set('hasta', e.target.value)}
                className="field"
              />
            </label>
          </>
        )}
        <select
          aria-label="Estado"
          value={status}
          onChange={(e) => set('estado', e.target.value)}
          className="field"
        >
          <option value="">Todas</option>
          <option value="borrador">Borradores</option>
          <option value="confirmada">Confirmadas</option>
        </select>
      </div>
      {badRange ? (
        <p role="alert" className="text-error">
          La fecha inicial va antes de la final.
        </p>
      ) : purchases.isPending ? (
        <p role="status" className="text-on-surface-variant">
          Cargando…
        </p>
      ) : purchases.isError ? (
        <p role="alert" className="text-error">
          {purchases.error.message}
        </p>
      ) : items.length === 0 ? (
        <p className="text-on-surface-variant">
          {filtered
            ? 'Ninguna compra coincide con los filtros.'
            : 'Aún no hay compras. Registra la primera con "Nueva compra".'}
        </p>
      ) : (
        days.map((day) => (
          <section key={day.key} aria-label={day.title} className="flex flex-col gap-2">
            <h2 className="text-label font-medium text-on-surface-variant">{day.title}</h2>
            <ul className="flex flex-col gap-2">
              {day.items.map((p) => (
                <PurchaseItem key={p.id} purchase={p} lookups={lookups} />
              ))}
            </ul>
          </section>
        ))
      )}
      {purchases.hasNextPage && (
        <button
          type="button"
          className="btn-outline self-center"
          disabled={purchases.isFetchingNextPage}
          onClick={() => void purchases.fetchNextPage()}
        >
          {purchases.isFetchingNextPage ? 'Cargando…' : 'Ver más'}
        </button>
      )}
    </section>
  );
}
