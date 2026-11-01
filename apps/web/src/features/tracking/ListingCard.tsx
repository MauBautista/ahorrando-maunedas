import type { ListingWithState } from '@maunedas/shared/api/listings';
import { agoTime, formatMoney } from '../../lib/format';
import { checkRequested, HEALTH_HELP, HEALTH_LABEL, intervalText, listingHealth } from './labels';

const BADGE: Record<string, string> = {
  ok: 'border-primary text-primary',
  blocked: 'border-error text-error',
  error: 'border-error text-error',
  not_found: 'border-error text-error',
};

/** One tracked link (S-20): store, last price, last check, state and interval, with its actions. */
export function ListingCard({
  listing: l,
  now,
  busy,
  onCheckNow,
  onToggle,
  onRemove,
}: {
  listing: ListingWithState;
  now: number;
  busy: boolean;
  onCheckNow: () => void;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const health = listingHealth(l);
  const s = l.state;
  const price = s?.last_price_cents ?? null;
  const list = s?.last_list_price_cents ?? null;
  const requested = checkRequested(l);
  const every = intervalText(l.check_interval_min);
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-outline/30 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{l.store_name}</span>
        <span className={`rounded-full border px-2 text-label ${BADGE[health] ?? 'border-outline/60'}`}>
          {HEALTH_LABEL[health]}
        </span>
      </div>
      {price !== null && (
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className={`text-title ${health === 'out_of_stock' ? 'text-on-surface-variant' : ''}`}>
            {formatMoney(price)}
          </span>
          {list !== null && list > price && (
            <span
              className="text-label text-on-surface-variant line-through"
              aria-label={`Antes ${formatMoney(list)}`}
            >
              {formatMoney(list)}
            </span>
          )}
          {health === 'out_of_stock' && <span className="text-label">Último precio visto</span>}
        </p>
      )}
      {s?.last_promo_text && <p className="text-label text-primary">{s.last_promo_text}</p>}
      <p className="text-label text-on-surface-variant">
        {s?.last_checked_at ? `Revisado ${agoTime(s.last_checked_at, now)}` : 'Aún no se revisa'}
        {every && ` · ${every}`}
        {requested && ' · Revisión solicitada'}
      </p>
      {HEALTH_HELP[health] && <p className="text-label text-on-surface-variant">{HEALTH_HELP[health]}</p>}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-outline"
          disabled={busy || l.active !== 1 || requested}
          onClick={onCheckNow}
        >
          Revisar ahora
        </button>
        <button type="button" className="btn-text" disabled={busy} onClick={onToggle}>
          {l.active === 1 ? 'Pausar' : 'Reanudar'}
        </button>
        <a
          href={l.url}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-text inline-flex items-center"
        >
          Abrir en la tienda
        </a>
        <button type="button" className="btn-text text-error" disabled={busy} onClick={onRemove}>
          Dejar de seguir
        </button>
      </div>
    </li>
  );
}
