import type { PurchaseDetailResponse } from '@maunedas/shared/api/purchases';
import { parseCents, plainCents } from '@maunedas/shared/text/decimal';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useBlocker, useLocation, useNavigate, useParams } from 'react-router';
import { Dialog } from '../../../components/Dialog';
import { ApiError } from '../../../lib/api';
import { useApi } from '../../../lib/context';
import { dateKey, timeKey, zonedEpoch } from '../../../lib/dates';
import { formatMoney } from '../../../lib/format';
import { useLookups } from '../../../lib/lookups';
import { newRow, push } from '../../../lib/sync';
import { conflictMessage } from '../../catalog/editor/conflicts';
import { Totals } from '../Totals';
import { usePurchase } from '../usePurchase';
import { draftOf, emptyDraft, type PurchaseDraft, type PurchaseLine, totalsOf } from './draft';
import { lineFormOf, type LineForm, newLineForm, validateLine } from './lineForm';
import { LineDialog } from './LineDialog';
import { LinesList } from './LinesList';
import { purchaseMutations, deletePurchaseMutations } from './mutations';
import { NewBranchDialog, NewStoreDialog, type StoreKind } from './PlaceDialogs';

/** W-05 (05 §5 S-04, S-05): `/compras/nueva` or `/compras/:id/editar`. */
export function PurchaseEditorPage() {
  const { id } = useParams();
  const purchase = usePurchase(id);
  if (id && purchase.isPending) {
    return (
      <p role="status" className="text-on-surface-variant">
        Cargando…
      </p>
    );
  }
  if (id && purchase.isError) {
    return (
      <p role="alert" className="text-error">
        {purchase.error instanceof ApiError && purchase.error.status === 404
          ? 'Esta compra no existe o se eliminó.'
          : purchase.error.message}
      </p>
    );
  }
  return <Editor key={id ?? 'nueva'} detail={id ? purchase.data! : null} />;
}

const DEFAULT_CITY = 'Puebla';

function Editor({ detail }: { detail: PurchaseDetailResponse | null }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: lookups } = useLookups();
  const [draft, setDraft] = useState<PurchaseDraft>(() =>
    detail ? draftOf(detail) : emptyDraft(Date.now()),
  );
  const [saved, setSaved] = useState(draft);
  const [line, setLine] = useState<{ form: LineForm; promoId: string | null } | null>(null);
  /** The index of the line in the dialog; null for a new one. */
  const [editing, setEditing] = useState<number | null>(null);
  const [discount, setDiscount] = useState<{
    index: number | null;
    description: string;
    amount: string;
    error: string | null;
  } | null>(null);
  const [removed, setRemoved] = useState<{ index: number; line: PurchaseLine } | null>(null);
  const [place, setPlace] = useState<'store' | 'branch' | null>(null);
  // A conflict while creating reopens the editor on the saved purchase, with its message.
  const [problem, setProblem] = useState<string | null>(
    (useLocation().state as { problem?: string } | null)?.problem ?? null,
  );
  const [mismatch, setMismatch] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [ticketText, setTicketText] = useState(
    draft.ticketTotalCents === null ? '' : plainCents(draft.ticketTotalCents),
  );
  const leaving = useRef(false);
  const totals = totalsOf(draft);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const branches = lookups?.store_branches.filter((b) => b.store_id === draft.storeId) ?? [];

  const change = (next: (d: PurchaseDraft) => PurchaseDraft) => {
    setDraft(next);
    setProblem(null);
    setRemoved(null);
  };

  /** Pushes the purchase; true when every row was taken. A conflict reloads what the server has. */
  async function write(confirm: boolean): Promise<string | null> {
    const { purchaseId, mutations } = purchaseMutations(draft, detail, confirm, Date.now());
    setBusy(true);
    try {
      const res = await push(api, mutations);
      await queryClient.invalidateQueries();
      const message = conflictMessage(res.conflicts);
      if (message) {
        // Whatever was taken is on the server now: the editor starts again from it.
        if (!detail) {
          leaving.current = true;
          navigate(`/compras/${purchaseId}/editar`, { replace: true, state: { problem: message } });
          return null;
        }
        const fresh = queryClient.getQueryData<PurchaseDetailResponse>(['purchase', purchaseId]);
        if (fresh) {
          const reloaded = draftOf(fresh);
          setDraft(reloaded);
          setSaved(reloaded);
          setTicketText(reloaded.ticketTotalCents === null ? '' : plainCents(reloaded.ticketTotalCents));
        }
        setProblem(message);
        return null;
      }
      setSaved(draft);
      return purchaseId;
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'No se pudo guardar.');
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function saveAndShow(confirm: boolean) {
    const id = await write(confirm);
    if (!id) return;
    leaving.current = true;
    navigate(`/compras/${id}`, { replace: true });
  }

  function saveDraft() {
    if (!draft.storeId) return setProblem('Elige la tienda para confirmar.');
    void saveAndShow(false);
  }

  /** RF-COM-06/07: needs a store and a product with its price; a total that does not match asks first. */
  function confirm() {
    const need = !draft.storeId
      ? 'Elige la tienda para confirmar.'
      : draft.lines.length === 0
        ? 'Agrega al menos un producto para confirmar.'
        : draft.lines.some((l) => l.unitPriceCents === 0)
          ? 'Hay productos sin precio: escríbelo antes de confirmar.'
          : null;
    if (need) return setProblem(need);
    if (totals.mismatch) return setMismatch(totals.difference_cents);
    void saveAndShow(true);
  }

  async function remove() {
    if (
      !detail ||
      !window.confirm('¿Eliminar esta compra con sus productos y descuentos? No se puede deshacer.')
    )
      return;
    setBusy(true);
    try {
      await push(api, deletePurchaseMutations(detail, Date.now()));
      await queryClient.invalidateQueries();
      leaving.current = true;
      navigate('/compras', { replace: true });
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'No se pudo eliminar.');
    } finally {
      setBusy(false);
    }
  }

  // "Autoguardado del borrador al salir" (05 §5 S-04): anything with a store that changed is written first.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && !leaving.current && currentLocation.pathname !== nextLocation.pathname,
  );
  // Each attempt to leave is answered once: a render may still show it blocked after it was let go.
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (blocker.state !== 'blocked' || handled.current === blocker.location.key) return;
    handled.current = blocker.location.key;
    const empty = !draft.id && draft.lines.length === 0 && draft.ticketDiscounts.length === 0;
    if (!draft.storeId || empty) return blocker.proceed();
    // The save starts after this effect, as it would from a button.
    void Promise.resolve()
      .then(() => write(false))
      .then((id) => (id ? blocker.proceed() : blocker.reset()));
  });
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  async function createStore(name: string, kind: StoreKind) {
    const row = newRow({ name, kind, default_check_interval_min: 480 });
    if (await pushPlace('stores', row)) change((d) => ({ ...d, storeId: row.id, branchId: null }));
  }

  async function createBranch(name: string, city: string | null) {
    const row = newRow({ store_id: draft.storeId, name, city });
    if (await pushPlace('store_branches', row)) change((d) => ({ ...d, branchId: row.id }));
  }

  async function pushPlace(table: string, row: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await push(api, [{ table, row }]);
      const message = conflictMessage(res.conflicts);
      if (message) {
        setProblem(message);
        return false;
      }
      await queryClient.invalidateQueries({ queryKey: ['lookups'] });
      setPlace(null);
      return true;
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'No se pudo guardar.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  /** The line in its place, or at the end; "Guardar y otro" leaves the dialog open for a new one. */
  function saveLine(next: PurchaseLine, another: boolean) {
    change((d) => {
      const lines = [...d.lines];
      if (editing !== null) lines[editing] = next;
      else lines.push(next);
      return { ...d, lines };
    });
    setEditing(null);
    if (!another) setLine(null);
  }

  function openLine(index: number | null) {
    if (index === null && !draft.storeId) return setProblem('Primero elige la tienda.');
    const current = index === null ? null : draft.lines[index]!;
    setEditing(index);
    setLine({ form: current ? lineFormOf(current) : newLineForm(), promoId: current?.promotion?.id ?? null });
  }

  function saveDiscount() {
    if (!discount) return;
    const amount = parseCents(discount.amount);
    if (amount === null || amount <= 0) return setDiscount({ ...discount, error: 'Escribe el monto.' });
    const description = discount.description.trim() || 'Descuento';
    change((d) => {
      const list = [...d.ticketDiscounts];
      const i = discount.index;
      if (i !== null && i < list.length) list[i] = { ...list[i]!, description, amountCents: amount };
      else list.push({ id: null, description, amountCents: amount });
      return { ...d, ticketDiscounts: list };
    });
    setDiscount(null);
  }

  const date = dateKey(draft.purchasedAt);
  const time = timeKey(draft.purchasedAt);
  const city =
    branches.find((b) => b.city)?.city ?? lookups?.store_branches.find((b) => b.city)?.city ?? DEFAULT_CITY;

  return (
    <section className="flex flex-col gap-4 pb-24">
      <h1 className="text-title">{detail ? 'Compra' : 'Nueva compra'}</h1>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="flex items-end gap-2">
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-label">Tienda</span>
            <select
              value={draft.storeId ?? ''}
              onChange={(e) => change((d) => ({ ...d, storeId: e.target.value || null, branchId: null }))}
              className="field"
            >
              <option value="">Elegir tienda</option>
              {(lookups?.stores ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn-text" onClick={() => setPlace('store')}>
            Nueva tienda
          </button>
        </div>
        {draft.storeId && (
          <div className="flex items-end gap-2">
            <label className="flex flex-1 flex-col gap-1">
              <span className="text-label">Sucursal (opcional)</span>
              <select
                value={draft.branchId ?? ''}
                onChange={(e) => change((d) => ({ ...d, branchId: e.target.value || null }))}
                className="field"
              >
                <option value="">Sin sucursal</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.city ? `${b.name} (${b.city})` : b.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="btn-text" onClick={() => setPlace('branch')}>
              Nueva sucursal
            </button>
          </div>
        )}
        <div className="flex gap-2">
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-label">Fecha</span>
            <input
              type="date"
              value={date}
              onChange={(e) =>
                e.target.value && change((d) => ({ ...d, purchasedAt: zonedEpoch(e.target.value, time) }))
              }
              className="field"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-label">Hora</span>
            <input
              type="time"
              value={time}
              onChange={(e) =>
                e.target.value && change((d) => ({ ...d, purchasedAt: zonedEpoch(date, e.target.value) }))
              }
              className="field"
            />
          </label>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-title">Productos</h2>
        <button type="button" className="btn-outline" onClick={() => openLine(null)}>
          + Producto
        </button>
      </div>
      <LinesList
        lines={draft.lines}
        actions={{
          open: (i) => openLine(i),
          move: (i, delta) =>
            change((d) => {
              const lines = [...d.lines];
              const [moved] = lines.splice(i, 1);
              lines.splice(i + delta, 0, moved!);
              return { ...d, lines };
            }),
          remove: (i) => {
            const gone = draft.lines[i]!;
            change((d) => ({ ...d, lines: d.lines.filter((_, j) => j !== i) }));
            setRemoved({ index: i, line: gone });
          },
          edit: (i, cell, text) => {
            const current = draft.lines[i]!;
            const form = { ...lineFormOf(current), [cell]: text };
            const { line: next, form: checked } = validateLine(form, current.promotion?.id ?? null);
            if (!next) return checked.error;
            change((d) => ({ ...d, lines: d.lines.map((l, j) => (j === i ? next : l)) }));
            return null;
          },
        }}
      />
      {removed && (
        <p role="status" className="flex items-center gap-2 rounded-lg bg-surface-variant p-2">
          Se quitó{' '}
          {removed.line.variant
            ? `${removed.line.variant.productName} · ${removed.line.variant.label}`
            : removed.line.rawText}
          .
          <button
            type="button"
            className="btn-text"
            onClick={() => {
              setDraft((d) => {
                const lines = [...d.lines];
                lines.splice(Math.min(removed.index, lines.length), 0, removed.line);
                return { ...d, lines };
              });
              setRemoved(null);
            }}
          >
            Deshacer
          </button>
        </p>
      )}

      <div className="flex items-center justify-between">
        <h2 className="text-title">Descuentos del ticket</h2>
        <button
          type="button"
          className="btn-outline"
          onClick={() => setDiscount({ index: null, description: '', amount: '', error: null })}
        >
          + Descuento del ticket
        </button>
      </div>
      <Totals
        draft={draft}
        totals={totals}
        discounts={draft.ticketDiscounts.map((d, i) => (
          <div key={d.id ?? `new-${i}`} className="col-span-2 flex items-center justify-between gap-2">
            <button
              type="button"
              className="flex-1 text-left underline-offset-2 hover:underline"
              onClick={() =>
                setDiscount({
                  index: i,
                  description: d.description,
                  amount: plainCents(d.amountCents),
                  error: null,
                })
              }
            >
              {d.description}
            </button>
            <span className="tabular-nums">−{formatMoney(d.amountCents)}</span>
            <button
              type="button"
              className="btn-text px-2"
              aria-label={`Quitar el descuento ${d.description}`}
              onClick={() =>
                change((x) => ({ ...x, ticketDiscounts: x.ticketDiscounts.filter((_, j) => j !== i) }))
              }
            >
              ✕
            </button>
          </div>
        ))}
        ticketTotal={
          <label className="col-span-2 flex items-center justify-between gap-2">
            <span>Total del ticket</span>
            <input
              inputMode="decimal"
              placeholder="0.00"
              value={ticketText}
              onChange={(e) => {
                setTicketText(e.target.value);
                const cents = parseCents(e.target.value);
                change((d) => ({ ...d, ticketTotalCents: cents }));
              }}
              className="field w-36 text-right"
            />
          </label>
        }
      />

      {problem && (
        <p role="alert" className="text-error">
          {problem}
        </p>
      )}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-outline/30 bg-surface p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2">
          <span className="mr-auto font-medium tabular-nums">Total {formatMoney(totals.computed_cents)}</span>
          {detail && (
            <button
              type="button"
              className="btn-text text-error"
              disabled={busy}
              onClick={() => void remove()}
            >
              Eliminar compra
            </button>
          )}
          <button type="button" className="btn-outline" disabled={busy} onClick={saveDraft}>
            {draft.confirmed ? 'Guardar' : 'Guardar borrador'}
          </button>
          {!draft.confirmed && (
            <button type="button" className="btn-primary" disabled={busy} onClick={confirm}>
              Confirmar
            </button>
          )}
        </div>
      </div>

      {line && (
        <LineDialog
          form={line.form}
          storeId={draft.storeId}
          promoId={line.promoId}
          onSave={saveLine}
          onClose={() => {
            setLine(null);
            setEditing(null);
          }}
        />
      )}
      {discount && (
        <Dialog title="Descuento del ticket" onClose={() => setDiscount(null)}>
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-label">Descripción (por ejemplo, cupón)</span>
              <input
                value={discount.description}
                onChange={(e) => setDiscount({ ...discount, description: e.target.value, error: null })}
                className="field"
                maxLength={300}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-label">Monto</span>
              <input
                inputMode="decimal"
                placeholder="0.00"
                value={discount.amount}
                onChange={(e) => setDiscount({ ...discount, amount: e.target.value, error: null })}
                className="field"
              />
            </label>
            {discount.error && (
              <p role="alert" className="text-error">
                {discount.error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-outline" onClick={() => setDiscount(null)}>
                Cancelar
              </button>
              <button type="button" className="btn-primary" onClick={saveDiscount}>
                Guardar
              </button>
            </div>
          </div>
        </Dialog>
      )}
      {mismatch !== null && (
        <Dialog title="El total no cuadra" onClose={() => setMismatch(null)}>
          <p>El total no cuadra por {formatMoney(Math.abs(mismatch))}. ¿Confirmar de todos modos?</p>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className="btn-outline" onClick={() => setMismatch(null)}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                setMismatch(null);
                void saveAndShow(true);
              }}
            >
              Confirmar
            </button>
          </div>
        </Dialog>
      )}
      {place === 'store' && (
        <NewStoreDialog
          busy={busy}
          onSave={(n, k) => void createStore(n, k)}
          onClose={() => setPlace(null)}
        />
      )}
      {place === 'branch' && (
        <NewBranchDialog
          defaultCity={city}
          busy={busy}
          onSave={(n, c) => void createBranch(n, c)}
          onClose={() => setPlace(null)}
        />
      )}
    </section>
  );
}
