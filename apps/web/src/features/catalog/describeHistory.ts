import type { HistoryPoint, HistoryResponse } from '@maunedas/shared/api/catalog';
import { formatDate, formatUnitPrice } from '../../lib/format';

/** Screen readers get what the chart shows: how many prices, from when to when, the lowest and the highest. */
export function describeHistory(points: HistoryPoint[], unit: HistoryResponse['display_unit']): string {
  const prices = points.map((p) => p.display_cents);
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const count = points.length === 1 ? '1 precio' : `${points.length} precios`;
  const span =
    first.observed_at === last.observed_at
      ? `del ${formatDate(first.observed_at)}`
      : `del ${formatDate(first.observed_at)} al ${formatDate(last.observed_at)}`;
  return `${count} ${span}; el más bajo ${formatUnitPrice(Math.min(...prices), unit)} y el más alto ${formatUnitPrice(Math.max(...prices), unit)}.`;
}
