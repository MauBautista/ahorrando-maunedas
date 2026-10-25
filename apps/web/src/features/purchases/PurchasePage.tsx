import { Link, useParams } from 'react-router';
import { ApiError } from '../../lib/api';
import { dayTitle, formatTime } from '../../lib/dates';
import { formatMoney, formatUnitPrice } from '../../lib/format';
import { useLookups } from '../../lib/lookups';
import { promotionText } from '../../lib/promotions';
import { amountsOf, draftOf, lineTitle, quantityText, totalsOf } from './editor/draft';
import { Totals } from './Totals';
import { usePurchase } from './usePurchase';

/**
 * W-04 (06 §3): a purchase to read: its products with quantity, price, promotion, total and what each unit cost
 * with the ticket discount prorated (as the history), the ticket discounts, the totals and the ticket's pages.
 */
export function PurchasePage() {
  const { id } = useParams();
  const purchase = usePurchase(id);
  const { data: lookups } = useLookups();
  if (purchase.isPending) {
    return (
      <p role="status" className="text-on-surface-variant">
        Cargando…
      </p>
    );
  }
  if (purchase.isError) {
    return (
      <p role="alert" className="text-error">
        {purchase.error instanceof ApiError && purchase.error.status === 404
          ? 'Esta compra no existe o se eliminó.'
          : purchase.error.message}
      </p>
    );
  }
  const detail = purchase.data;
  const draft = draftOf(detail);
  const p = detail.purchase;
  const store = lookups?.stores.find((s) => s.id === p.store_id)?.name ?? 'Tienda sin sincronizar';
  const branch = p.branch_id ? lookups?.store_branches.find((b) => b.id === p.branch_id)?.name : undefined;
  const paid = new Map(detail.items.map((i) => [i.id, i]));
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-title">{branch ? `${store} · ${branch}` : store}</h1>
          <p className="text-on-surface-variant">
            {dayTitle(p.purchased_at, purchase.dataUpdatedAt)}, {formatTime(p.purchased_at)}
            {p.status === 'draft' && ' · Borrador'}
          </p>
        </div>
        <Link to={`/compras/${p.id}/editar`} className="btn-primary inline-flex items-center">
          Editar
        </Link>
      </div>
      <h2 className="text-label font-medium text-on-surface-variant">Productos</h2>
      {draft.lines.length === 0 ? (
        <p className="text-on-surface-variant">Aún no hay productos en esta compra.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-outline/30 rounded-xl border border-outline/30">
          {draft.lines.map((line) => {
            const item = paid.get(line.id!)!;
            return (
              <li key={line.id} className={`flex flex-col gap-1 p-3 ${line.variant ? '' : 'bg-warning/10'}`}>
                <div className="flex justify-between gap-3">
                  <span className="font-medium">{lineTitle(line)}</span>
                  <span className="font-medium tabular-nums">{formatMoney(amountsOf(line).final_cents)}</span>
                </div>
                <span className="text-label text-on-surface-variant">
                  {line.unitPriceCents === 0
                    ? 'Sin precio'
                    : `${quantityText(line.quantity)} × ${formatMoney(line.unitPriceCents)}`}
                  {line.promotion && ` · ${promotionText(line.promotion.type, line.promotion.params)}`}
                </span>
                {item.display_cents !== null && item.display_unit && (
                  <span className="text-label text-on-surface-variant">
                    {formatUnitPrice(item.display_cents, item.display_unit)}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <Totals draft={draft} totals={totalsOf(draft)} />
      {detail.receipt_images.length > 0 && (
        <>
          <h2 className="text-label font-medium text-on-surface-variant">Ticket</h2>
          <ul className="flex flex-wrap gap-3">
            {detail.receipt_images.map((img, i) => {
              const url = img.processed_url ?? img.original_url;
              return (
                <li key={img.image_id}>
                  {url ? (
                    <a href={url} target="_blank" rel="noreferrer">
                      <img
                        src={img.thumb_url ?? url}
                        alt={`Página ${i + 1} del ticket`}
                        className="h-40 rounded-lg border border-outline/30 object-cover"
                      />
                    </a>
                  ) : (
                    <span className="text-label text-on-surface-variant">Página {i + 1}: aún no se sube</span>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
