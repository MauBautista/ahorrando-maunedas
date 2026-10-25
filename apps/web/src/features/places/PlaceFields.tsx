import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useApi } from '../../lib/context';
import { useLookups } from '../../lib/lookups';
import { newRow, push } from '../../lib/sync';
import { conflictMessage } from '../catalog/editor/conflicts';
import { NewBranchDialog, NewStoreDialog, type StoreKind } from './PlaceDialogs';

const DEFAULT_CITY = 'Puebla';

/**
 * S-14 in the web: the store and its optional branch, with "Nueva tienda" and "Nueva sucursal" written at once (as
 * Android), for the purchase editor (W-05) and the shelf price (W-10). Two blocks, so the parent's grid places them.
 */
export function PlaceFields({
  storeId,
  branchId,
  onChange,
  onProblem,
}: {
  storeId: string | null;
  branchId: string | null;
  onChange: (storeId: string | null, branchId: string | null) => void;
  onProblem: (message: string) => void;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const { data: lookups } = useLookups();
  const [dialog, setDialog] = useState<'store' | 'branch' | null>(null);
  const [busy, setBusy] = useState(false);
  const branches = lookups?.store_branches.filter((b) => b.store_id === storeId) ?? [];
  // The city of a branch already used, or Puebla (Android's `defaultBranchCity`).
  const city =
    branches.find((b) => b.city)?.city ?? lookups?.store_branches.find((b) => b.city)?.city ?? DEFAULT_CITY;

  async function create(table: string, row: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    try {
      const res = await push(api, [{ table, row }]);
      const message = conflictMessage(res.conflicts);
      if (message) {
        onProblem(message);
        return false;
      }
      await queryClient.invalidateQueries({ queryKey: ['lookups'] });
      setDialog(null);
      return true;
    } catch (e) {
      onProblem(e instanceof Error ? e.message : 'No se pudo guardar.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function createStore(name: string, kind: StoreKind) {
    const row = newRow({ name, kind, default_check_interval_min: 480 });
    if (await create('stores', row)) onChange(row.id, null);
  }

  async function createBranch(name: string, branchCity: string | null) {
    const row = newRow({ store_id: storeId, name, city: branchCity });
    if (await create('store_branches', row)) onChange(storeId, row.id);
  }

  return (
    <>
      <div className="flex items-end gap-2">
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-label">Tienda</span>
          <select
            value={storeId ?? ''}
            onChange={(e) => onChange(e.target.value || null, null)}
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
        <button type="button" className="btn-text" onClick={() => setDialog('store')}>
          Nueva tienda
        </button>
      </div>
      {storeId && (
        <div className="flex items-end gap-2">
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-label">Sucursal (opcional)</span>
            <select
              value={branchId ?? ''}
              onChange={(e) => onChange(storeId, e.target.value || null)}
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
          <button type="button" className="btn-text" onClick={() => setDialog('branch')}>
            Nueva sucursal
          </button>
        </div>
      )}
      {dialog === 'store' && (
        <NewStoreDialog
          busy={busy}
          onSave={(n, k) => void createStore(n, k)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'branch' && (
        <NewBranchDialog
          defaultCity={city}
          busy={busy}
          onSave={(n, c) => void createBranch(n, c)}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}
