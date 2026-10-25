import type { PriceSource } from '@maunedas/shared/api/catalog';
import type { DisplayUnit } from '@maunedas/shared/pricing/units';
import { formatUnitPrice, SOURCE_LABEL } from '../lib/format';

const DOT: Record<PriceSource, string> = {
  purchase: 'bg-price-purchase',
  shelf: 'bg-price-shelf',
  web: 'bg-price-web',
};

/** A price per unit with the dot of its source (Android's `UnitPriceText`); the source is said, not only colored. */
export function UnitPrice({
  cents,
  unit,
  source,
  className = '',
}: {
  cents: number;
  unit: DisplayUnit;
  source: PriceSource;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <span className={`size-2.5 rounded-full ${DOT[source]}`} aria-hidden />
      <span className="sr-only">{SOURCE_LABEL[source]}:</span>
      {formatUnitPrice(cents, unit)}
    </span>
  );
}
