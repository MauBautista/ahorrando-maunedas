import type {
  CompareResponse,
  CompareRow,
  LookupsResponse,
  ProductDetailVariant,
} from '@maunedas/shared/api/catalog';
import { useQuery } from '@tanstack/react-query';
import { UnitPrice } from '../../components/UnitPrice';
import { useApi } from '../../lib/context';
import { ago, formatUnitPrice, unitLabel } from '../../lib/format';
import { storeName } from '../../lib/lookups';

/**
 * "Comparar" (RF-PRE-04, `GET /v1/products/:id/compare`): variant × store with the last, lowest and 90-day average
 * price per unit; the cheapest is marked. Variants of another measure go apart, since they do not compare.
 */
export function CompareTab({
  productId,
  variants,
  lookups,
}: {
  productId: string;
  variants: ProductDetailVariant[];
  lookups: LookupsResponse | undefined;
}) {
  const api = useApi();
  const compare = useQuery({
    queryKey: ['compare', productId],
    queryFn: () => api.get<CompareResponse>(`/v1/products/${productId}/compare?days=90`),
  });
  if (compare.isPending) return <p role="status">Cargando…</p>;
  if (compare.isError) return <p role="alert">{compare.error.message}</p>;
  const { rows, best, display_unit } = compare.data;
  if (rows.length === 0)
    return <p className="text-on-surface-variant">Sin precios en los últimos 90 días.</p>;
  const label = (id: string) => variants.find((v) => v.id === id)?.label ?? 'Presentación';
  const comparable = rows.filter((r) => r.display_unit === display_unit);
  const others = rows.filter((r) => r.display_unit !== display_unit);
  const table = (list: CompareRow[]) => (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead className="text-label text-on-surface-variant">
          <tr>
            <th className="p-2">Presentación</th>
            <th className="p-2">Tienda</th>
            <th className="p-2">Último</th>
            <th className="p-2">Mínimo</th>
            <th className="p-2">Promedio</th>
            <th className="p-2">Precios</th>
          </tr>
        </thead>
        <tbody>
          {list.map((r) => {
            const cheapest = best?.variant_id === r.variant_id && best.store_id === r.store_id;
            return (
              <tr
                key={`${r.variant_id}:${r.store_id}`}
                className={`border-t border-outline/20 ${cheapest ? 'bg-surface-variant' : ''}`}
              >
                <td className="p-2">
                  {label(r.variant_id)}
                  {cheapest && (
                    <span className="ml-2 rounded-sm bg-primary px-2 py-0.5 text-label text-on-primary">
                      Más barato
                    </span>
                  )}
                </td>
                <td className="p-2">{storeName(lookups, r.store_id)}</td>
                <td className="p-2">
                  <UnitPrice cents={r.last.display_cents} unit={r.display_unit} source={r.last.source} />
                  <span className="block text-label text-on-surface-variant">
                    {ago(r.last.observed_at, compare.dataUpdatedAt)}
                  </span>
                </td>
                <td className="p-2">{formatUnitPrice(r.min.display_cents, r.display_unit)}</td>
                <td className="p-2">{formatUnitPrice(r.avg_display_cents, r.display_unit)}</td>
                <td className="p-2">{r.n}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
  return (
    <div className="flex flex-col gap-4">
      <p className="text-label text-on-surface-variant">
        Últimos 90 días, por {display_unit === 'pz' ? 'pieza' : unitLabel(display_unit)}.
      </p>
      {comparable.length > 0 && table(comparable)}
      {others.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-label font-medium">Otras medidas (no se comparan)</h2>
          {table(others)}
        </section>
      )}
    </div>
  );
}
