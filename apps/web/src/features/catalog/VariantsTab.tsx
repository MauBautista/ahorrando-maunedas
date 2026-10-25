import type { LookupsResponse, ProductDetailVariant } from '@maunedas/shared/api/catalog';
import { UnitPrice } from '../../components/UnitPrice';
import { ago, SOURCE_LABEL } from '../../lib/format';
import { storeName } from '../../lib/lookups';

/** "Presentaciones": each variant with its codes and the latest price per store and source (`latestPoints`). */
export function VariantsTab({
  variants,
  lookups,
  now,
}: {
  variants: ProductDetailVariant[];
  lookups: LookupsResponse | undefined;
  /** When the product arrived: ages count from there. */
  now: number;
}) {
  if (variants.length === 0)
    return <p className="text-on-surface-variant">Este producto aún no tiene presentaciones.</p>;
  return (
    <ul className="grid gap-3 md:grid-cols-2">
      {variants.map((v) => (
        <li key={v.id} className="flex flex-col gap-2 rounded-xl border border-outline/30 p-4">
          <h2 className="text-title">{v.label}</h2>
          {v.sold_by_weight === 1 && (
            <p className="text-label text-on-surface-variant">A granel: se pesa en la tienda.</p>
          )}
          <p className="text-label text-on-surface-variant">
            {v.barcodes.length ? `Códigos: ${v.barcodes.join(', ')}` : 'Sin código de barras'}
          </p>
          {v.latest.length === 0 ? (
            <p className="text-on-surface-variant">Sin precios registrados.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {v.latest.map((p) => (
                <li key={`${p.store_id}:${p.source}`} className="flex flex-wrap items-baseline gap-x-2">
                  <UnitPrice
                    cents={p.display_cents}
                    unit={p.display_unit}
                    source={p.source}
                    className="font-medium"
                  />
                  <span className="text-label text-on-surface-variant">
                    {storeName(lookups, p.store_id)} · {SOURCE_LABEL[p.source]} · {ago(p.observed_at, now)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}
