import type { ListingWithState } from '@maunedas/shared/api/listings';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Dialog } from '../../components/Dialog';
import { useApi } from '../../lib/context';
import { push, touchedAt } from '../../lib/sync';
import { CatalogTabs } from '../catalog/CatalogTabs';
import { conflictMessage } from '../catalog/editor/conflicts';
import { AddListingDialog } from './AddListingDialog';
import { subjectName } from './labels';
import { ListingCard } from './ListingCard';
import { useListings } from './queries';
import { usePresetVariant } from './presetVariant';

/** The listings of each variant together, in the server's order (product, variant, store). */
function byVariant(items: ListingWithState[]): ListingWithState[][] {
  const groups = new Map<string, ListingWithState[]>();
  for (const l of items) groups.set(l.variant_id, [...(groups.get(l.variant_id) ?? []), l]);
  return [...groups.values()];
}

/**
 * W-20 (S-20, S-21): the online prices the home server follows, grouped by variant, with "Revisar ahora", pause and
 * removal; "Seguir un enlace" adds one. `?producto=&variante=` (from the product page) shows one variant only.
 */
export function TrackingPage() {
  const api = useApi();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const variantId = params.get('variante');
  const preset = usePresetVariant(params.get('producto'), variantId);
  const listings = useListings(variantId);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<ListingWithState | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['listings'] });

  async function act(l: ListingWithState, work: () => Promise<string | null>) {
    setBusyId(l.id);
    setNotice(null);
    try {
      const problem = await work();
      if (problem) setNotice({ ok: false, text: problem });
      await refresh();
    } catch (e) {
      setNotice({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusyId(null);
    }
  }

  const write = async (row: Record<string, unknown>) =>
    conflictMessage((await push(api, [{ table: 'listings', row }])).conflicts);

  const checkNow = (l: ListingWithState) =>
    act(l, async () => {
      await api.post(`/v1/listings/${l.id}/check-now`);
      setNotice({ ok: true, text: `El servidor casero revisará ${l.store_name} en unos minutos.` });
      return null;
    });
  const toggle = (l: ListingWithState) =>
    act(l, () => write({ id: l.id, updated_at: touchedAt(l.updated_at), active: l.active === 1 ? 0 : 1 }));
  const setInterval = (l: ListingWithState, minutes: number | null) =>
    act(l, () => write({ id: l.id, updated_at: touchedAt(l.updated_at), check_interval_min: minutes }));
  const remove = (l: ListingWithState) =>
    act(l, async () => {
      setRemoving(null);
      const now = Date.now();
      return write({ id: l.id, updated_at: touchedAt(l.updated_at, now), deleted_at: now });
    });

  const items = listings.data?.items ?? [];
  const now = listings.dataUpdatedAt;
  return (
    <section className="flex flex-col gap-4">
      <CatalogTabs />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-title">Seguimiento de precios en línea</h1>
        <button type="button" className="btn-primary" onClick={() => setAdding(true)}>
          Seguir un enlace
        </button>
      </div>
      {variantId && (
        <p className="text-on-surface-variant">
          Solo {preset ? subjectName(preset) : 'una presentación'}.{' '}
          <Link to="/seguimiento" className="underline">
            Ver todo
          </Link>
        </p>
      )}
      {notice && (
        <p role={notice.ok ? 'status' : 'alert'} className={notice.ok ? 'text-primary' : 'text-error'}>
          {notice.text}
        </p>
      )}
      {listings.isPending && <p role="status">Cargando…</p>}
      {listings.isError && (
        <p role="alert" className="text-error">
          {listings.error.message}
        </p>
      )}
      {listings.isSuccess && items.length === 0 && (
        <p className="text-on-surface-variant">
          Aún no sigues ningún precio en línea. Pega el enlace de un producto de Amazon, Sam’s Club o Costco y
          el servidor casero revisará su precio cada pocas horas.
        </p>
      )}
      {byVariant(items).map((group) => {
        const first = group[0]!;
        return (
          <section key={first.variant_id} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-title">
                <Link to={`/productos/${first.product_id}`} className="hover:underline">
                  {subjectName(first)}
                </Link>
              </h2>
              <Link
                to={`/alertas?producto=${first.product_id}&variante=${first.variant_id}`}
                className="btn-text"
              >
                Alertas
              </Link>
            </div>
            <ul className="grid gap-3 md:grid-cols-2">
              {group.map((l) => (
                <ListingCard
                  key={l.id}
                  listing={l}
                  now={now}
                  busy={busyId === l.id}
                  onCheckNow={() => checkNow(l)}
                  onToggle={() => toggle(l)}
                  onRemove={() => setRemoving(l)}
                  onInterval={(minutes) => setInterval(l, minutes)}
                />
              ))}
            </ul>
          </section>
        );
      })}
      {adding && (
        <AddListingDialog
          preset={preset}
          existing={items}
          onClose={() => setAdding(false)}
          onSaved={async () => {
            setAdding(false);
            setNotice({ ok: true, text: 'Listo. El servidor casero lo revisará en unos minutos.' });
            await refresh();
          }}
        />
      )}
      {removing && (
        <Dialog title="¿Dejar de seguir este enlace?" onClose={() => setRemoving(null)}>
          <p className="mb-4">
            {removing.store_name} · {subjectName(removing)}. Los precios ya guardados se conservan.
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-text" onClick={() => setRemoving(null)}>
              Cancelar
            </button>
            <button type="button" className="btn-primary" onClick={() => remove(removing)}>
              Dejar de seguir
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
