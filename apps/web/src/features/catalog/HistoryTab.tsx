import type {
  HistoryResponse,
  LookupsResponse,
  PriceSource,
  ProductDetailVariant,
} from '@maunedas/shared/api/catalog';
import { PRICE_SOURCES } from '@maunedas/shared/api/catalog';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from 'recharts';
import { UnitPrice } from '../../components/UnitPrice';
import { useApi } from '../../lib/context';
import { formatDate, formatMoney, formatUnitPrice, SOURCE_LABEL } from '../../lib/format';
import { describeHistory } from './describeHistory';
import { storeName } from '../../lib/lookups';

const DAY = 86_400_000;
const PERIODS = [
  { key: '90', label: '3 meses', days: 90 },
  { key: '365', label: '1 año', days: 365 },
  { key: 'todo', label: 'Todo', days: null },
] as const;
const COLOR: Record<PriceSource, string> = {
  purchase: 'var(--mn-price-purchase)',
  shelf: 'var(--mn-price-shelf)',
  web: 'var(--mn-price-web)',
};

/**
 * "Historial" (RF-PRE-02, `GET /v1/variants/:id/history`), with Android's filters (T58): variant, sources, period (one
 * year by default, as the API) and store. The chart has one series per source and only points: a line between two
 * prices would suggest prices nobody saw. The web's steps arrive with E2.
 */
export function HistoryTab({
  variants,
  lookups,
}: {
  variants: ProductDetailVariant[];
  lookups: LookupsResponse | undefined;
}) {
  const api = useApi();
  const [variantId, setVariantId] = useState(variants[0]?.id ?? '');
  const [sources, setSources] = useState<PriceSource[]>([...PRICE_SOURCES]);
  const [period, setPeriod] = useState<(typeof PERIODS)[number]['key']>('365');
  const [store, setStore] = useState('');
  const history = useQuery({
    queryKey: ['history', variantId, sources.join(','), period, store],
    queryFn: () => {
      const days = PERIODS.find((p) => p.key === period)!.days;
      const query = new URLSearchParams({ sources: sources.join(',') });
      query.set('from', String(days === null ? 0 : Date.now() - days * DAY));
      if (store) query.set('store_id', store);
      return api.get<HistoryResponse>(`/v1/variants/${variantId}/history?${query}`);
    },
    enabled: !!variantId && sources.length > 0,
  });
  if (variants.length === 0)
    return <p className="text-on-surface-variant">Este producto aún no tiene presentaciones.</p>;
  const toggle = (s: PriceSource) =>
    setSources((cur) =>
      cur.includes(s) ? cur.filter((x) => x !== s) : PRICE_SOURCES.filter((x) => x === s || cur.includes(x)),
    );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 md:flex-row md:flex-wrap">
        <select
          aria-label="Presentación"
          value={variantId}
          onChange={(e) => setVariantId(e.target.value)}
          className="field"
        >
          {variants.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </select>
        <select
          aria-label="Periodo"
          value={period}
          onChange={(e) => setPeriod(e.target.value as typeof period)}
          className="field"
        >
          {PERIODS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
        <select
          aria-label="Tienda"
          value={store}
          onChange={(e) => setStore(e.target.value)}
          className="field"
        >
          <option value="">Todas las tiendas</option>
          {(lookups?.stores ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <fieldset className="flex flex-wrap items-center gap-2">
          <legend className="sr-only">Fuentes</legend>
          {PRICE_SOURCES.map((s) => (
            <label
              key={s}
              className="inline-flex min-h-12 items-center gap-2 rounded-full border border-outline px-4"
            >
              <input type="checkbox" checked={sources.includes(s)} onChange={() => toggle(s)} />
              {SOURCE_LABEL[s]}
            </label>
          ))}
        </fieldset>
      </div>
      {sources.length === 0 ? (
        <p className="text-on-surface-variant">Elige al menos una fuente.</p>
      ) : history.isPending ? (
        <p role="status">Cargando…</p>
      ) : history.isError ? (
        <p role="alert">{history.error.message}</p>
      ) : history.data.points.length === 0 ? (
        <p className="text-on-surface-variant">Sin precios en este periodo.</p>
      ) : (
        <PriceHistory data={history.data} lookups={lookups} />
      )}
    </div>
  );
}

function PriceHistory({ data, lookups }: { data: HistoryResponse; lookups: LookupsResponse | undefined }) {
  const unit = data.display_unit;
  const description = describeHistory(data.points, unit);
  const bySource = PRICE_SOURCES.map((s) => ({
    source: s,
    points: data.points.filter((p) => p.source === s),
  })).filter((s) => s.points.length > 0);
  return (
    <>
      <figure aria-label={description} className="m-0 h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
            <CartesianGrid strokeOpacity={0.2} />
            <XAxis
              type="number"
              dataKey="observed_at"
              domain={['dataMin', 'dataMax']}
              tickFormatter={(v: number) => formatDate(v)}
              name="Fecha"
            />
            <YAxis
              type="number"
              dataKey="display_cents"
              tickFormatter={(v: number) => formatMoney(v)}
              name={`Precio por ${unit}`}
              width={80}
            />
            <Tooltip
              formatter={(value, name) =>
                name === 'Fecha' ? formatDate(Number(value)) : formatUnitPrice(Number(value), unit)
              }
              cursor={{ strokeDasharray: '3 3' }}
            />
            {bySource.map((s) => (
              <Scatter key={s.source} name={SOURCE_LABEL[s.source]} data={s.points} fill={COLOR[s.source]} />
            ))}
          </ScatterChart>
        </ResponsiveContainer>
        <figcaption className="sr-only">{description}</figcaption>
      </figure>
      <ul className="flex flex-col divide-y divide-outline/20" aria-label="Precios">
        {[...data.points].reverse().map((p) => (
          <li key={`${p.source}:${p.point_id}`} className="flex flex-wrap items-baseline gap-x-3 py-2">
            <UnitPrice cents={p.display_cents} unit={unit} source={p.source} className="font-medium" />
            <span className="text-label text-on-surface-variant">
              {storeName(lookups, p.store_id)} · {formatDate(p.observed_at)}
              {p.has_promo ? ' · Con promoción' : ''}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
