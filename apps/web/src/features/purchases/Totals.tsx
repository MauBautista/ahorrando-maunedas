import type { PurchaseTotals } from '@maunedas/shared/pricing/purchase';
import type { ReactNode } from 'react';
import { formatMoney } from '../../lib/format';
import type { PurchaseDraft } from './editor/draft';

/**
 * The footer of S-04 to read: Σ products, each ticket discount, the computed total and, with a ticket total, the
 * difference in red when it is more than $1.00 apart (RF-COM-06). [ticketTotal] replaces the ticket total's row, so
 * the editor can make it a field.
 */
export function Totals({
  draft,
  totals,
  ticketTotal,
  discounts,
}: {
  draft: PurchaseDraft;
  totals: PurchaseTotals;
  ticketTotal?: ReactNode;
  discounts?: ReactNode;
}) {
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 rounded-xl bg-surface-variant p-3">
      <dt>Suma de productos</dt>
      <dd className="text-right tabular-nums">{formatMoney(totals.lines_cents)}</dd>
      {discounts ??
        draft.ticketDiscounts.map((d, i) => (
          <Row
            key={d.id ?? i}
            label={d.description || 'Descuento'}
            value={`−${formatMoney(d.amountCents)}`}
          />
        ))}
      <dt className="font-medium">Total calculado</dt>
      <dd className="text-right font-medium tabular-nums">{formatMoney(totals.computed_cents)}</dd>
      {ticketTotal ??
        (draft.ticketTotalCents !== null && (
          <Row label="Total del ticket" value={formatMoney(draft.ticketTotalCents)} />
        ))}
      {totals.mismatch && (
        <dd role="status" className="col-span-2 text-error">
          No cuadra por {formatMoney(Math.abs(totals.difference_cents!))}
        </dd>
      )}
    </dl>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd className="text-right tabular-nums">{value}</dd>
    </>
  );
}
