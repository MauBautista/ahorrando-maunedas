import type { LookupsResponse } from '@maunedas/shared/api/catalog';
import type { PurchaseListItem } from '@maunedas/shared/api/purchases';
import { Link } from 'react-router';
import { formatTime } from '../../lib/dates';
import { formatMoney } from '../../lib/format';
import { linesText, purchaseTotal } from './total';

/** A purchase in a list (S-02, S-03): store and branch, when, total, products and "Borrador". */
export function PurchaseItem({
  purchase: p,
  lookups,
  when = formatTime,
}: {
  purchase: PurchaseListItem;
  lookups: LookupsResponse | undefined;
  when?: (at: number) => string;
}) {
  const store = lookups?.stores.find((s) => s.id === p.store_id)?.name ?? 'Tienda sin sincronizar';
  const branch = p.branch_id ? lookups?.store_branches.find((b) => b.id === p.branch_id)?.name : undefined;
  return (
    <li>
      <Link
        to={`/compras/${p.id}`}
        className="flex items-center gap-3 rounded-xl border border-outline/30 p-3 hover:bg-surface-variant"
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="font-medium">{branch ? `${store} · ${branch}` : store}</span>
          <span className="text-label text-on-surface-variant">
            {when(p.purchased_at)} · {linesText(p.lines)}
          </span>
        </div>
        {p.status === 'draft' && (
          <span className="rounded-full border border-warning px-2 py-0.5 text-label text-warning">
            Borrador
          </span>
        )}
        <span className="font-medium tabular-nums">{formatMoney(purchaseTotal(p))}</span>
      </Link>
    </li>
  );
}
