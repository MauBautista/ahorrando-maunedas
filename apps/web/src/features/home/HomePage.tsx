import type { PurchasesResponse } from '@maunedas/shared/api/purchases';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { useApi } from '../../lib/context';
import { dayTitle, formatTime, monthStart } from '../../lib/dates';
import { formatMoney } from '../../lib/format';
import { useLookups } from '../../lib/lookups';
import { useMe } from '../auth/useSession';
import { PurchaseItem } from '../purchases/PurchaseItem';
import { purchaseTotal } from '../purchases/total';

/**
 * W-02 (05 §5 S-02): the big actions, the month's spending (confirmed purchases of this month of Mexico City), the
 * open drafts and the 5 most recent purchases.
 */
export function HomePage() {
  const api = useApi();
  const { data } = useMe();
  const { data: lookups } = useLookups();
  const [now] = useState(() => Date.now());
  const name = data?.user.display_name.split(' ')[0] ?? '';
  const recent = useQuery({
    queryKey: ['purchases', 'recent'],
    queryFn: () => api.get<PurchasesResponse>('/v1/purchases?limit=5'),
  });
  const drafts = useQuery({
    queryKey: ['purchases', 'drafts'],
    queryFn: () => api.get<PurchasesResponse>('/v1/purchases?status=draft&limit=1'),
  });
  const spent = useQuery({
    queryKey: ['purchases', 'spent', monthStart(now)],
    queryFn: async () => {
      let total = 0;
      let cursor = '';
      // A household's month fits in a few pages of 100.
      do {
        const query = new URLSearchParams({
          from: String(monthStart(now)),
          status: 'confirmed',
          limit: '100',
        });
        if (cursor) query.set('cursor', cursor);
        const page = await api.get<PurchasesResponse>(`/v1/purchases?${query}`);
        total += page.items.reduce((sum, p) => sum + purchaseTotal(p), 0);
        cursor = page.next_cursor ?? '';
      } while (cursor);
      return total;
    },
  });
  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-display">Hola, {name}</h1>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Link to="/compras/nueva" className="action">
          Nueva compra
        </Link>
        <Link to="/compras/nueva?ticket=1" className="action">
          Foto de ticket
        </Link>
        <Link to="/anaquel/nuevo" className="action">
          Precio de anaquel
        </Link>
        <Link to="/catalogo" className="action">
          Catálogo
        </Link>
      </div>
      <div className="rounded-xl bg-surface-variant p-4">
        <p className="text-label text-on-surface-variant">Gasto del mes</p>
        <p className="text-title tabular-nums">{spent.data === undefined ? '…' : formatMoney(spent.data)}</p>
      </div>
      {!!drafts.data?.items.length && (
        <Link to="/compras?estado=borrador" className="rounded-xl border border-warning p-3 text-warning">
          Tienes compras en borrador. Revísalas y confírmalas.
        </Link>
      )}
      <section aria-labelledby="recent-title" className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 id="recent-title" className="text-title">
            Compras recientes
          </h2>
          <Link to="/compras" className="btn-text">
            Ver todas
          </Link>
        </div>
        {recent.data?.items.length === 0 ? (
          <p className="text-on-surface-variant">
            Aún no hay compras. Registra la primera con "Nueva compra".
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {recent.data?.items.map((p) => (
              <PurchaseItem
                key={p.id}
                purchase={p}
                lookups={lookups}
                when={(at) => `${dayTitle(at, now)}, ${formatTime(at)}`}
              />
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
