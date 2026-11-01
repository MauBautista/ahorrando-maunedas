import type {
  ListingWithState,
  ResolveListingResponse,
  UnsupportedUrlReason,
} from '@maunedas/shared/api/listings';
import { useState } from 'react';
import { Dialog } from '../../components/Dialog';
import { ApiError } from '../../lib/api';
import { useApi } from '../../lib/context';
import { storeName, useLookups } from '../../lib/lookups';
import { newRow, push } from '../../lib/sync';
import { conflictMessage } from '../catalog/editor/conflicts';
import { subjectName, UNSUPPORTED_REASON } from './labels';
import type { ChosenVariant } from './presetVariant';
import { VariantPicker } from './VariantPicker';

/**
 * S-21: paste a product link (or the text a store app shares) → `POST /v1/listings/resolve` → choose the variant
 * → the listing is created by sync. The agent checks a new listing within its next minute or so.
 */
export function AddListingDialog({
  preset,
  existing,
  onSaved,
  onClose,
}: {
  preset: ChosenVariant | null;
  /** The live listings, to refuse following the same page twice. */
  existing: ListingWithState[];
  onSaved: () => void;
  onClose: () => void;
}) {
  const api = useApi();
  const { data: lookups } = useLookups();
  const [text, setText] = useState('');
  const [resolved, setResolved] = useState<ResolveListingResponse | null>(null);
  const [variant, setVariant] = useState<ChosenVariant | null>(preset);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const twin = resolved && existing.find((l) => (l.canonical_url ?? l.url) === resolved.canonical_url);

  async function resolve() {
    setBusy(true);
    setProblem(null);
    try {
      setResolved(await api.post<ResolveListingResponse>('/v1/listings/resolve', { url: text }));
    } catch (e) {
      const reason =
        (e instanceof ApiError && (e.details as { reason?: UnsupportedUrlReason } | undefined)?.reason) ||
        null;
      setProblem(reason ? UNSUPPORTED_REASON[reason] : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!resolved || !variant) return;
    setBusy(true);
    setProblem(null);
    try {
      const row = newRow({
        variant_id: variant.variant_id,
        store_id: resolved.store_id,
        adapter: resolved.adapter,
        url: resolved.url,
        canonical_url: resolved.canonical_url,
        external_id: resolved.external_id,
        check_interval_min: null,
        active: 1,
      });
      const res = await push(api, [{ table: 'listings', row }]);
      const message = conflictMessage(res.conflicts);
      if (message) return setProblem(message);
      onSaved();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title="Seguir un enlace" onClose={onClose}>
      <div className="flex flex-col gap-3">
        {!resolved ? (
          <>
            <label className="flex flex-col gap-1">
              <span className="text-label">Enlace del producto</span>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                className="field min-h-24"
                placeholder="Pega el enlace de Amazon, Sam’s Club o Costco, o lo que compartió la app de la tienda"
                maxLength={2000}
              />
            </label>
            {problem && (
              <p role="alert" className="text-error">
                {problem}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-text" onClick={onClose}>
                Cancelar
              </button>
              <button type="button" className="btn-primary" disabled={busy || !text.trim()} onClick={resolve}>
                {busy ? 'Revisando…' : 'Continuar'}
              </button>
            </div>
          </>
        ) : (
          <>
            <p>
              <span className="font-medium">{storeName(lookups, resolved.store_id)}</span>
              <span className="block break-all text-label text-on-surface-variant">
                {resolved.canonical_url}
              </span>
            </p>
            {twin ? (
              <p role="alert" className="text-error">
                Ese enlace ya está en seguimiento para {subjectName(twin)}.
              </p>
            ) : (
              <div className="flex flex-col gap-1">
                <span className="text-label">¿Qué presentación es?</span>
                <VariantPicker value={variant} onChange={setVariant} />
              </div>
            )}
            {problem && (
              <p role="alert" className="text-error">
                {problem}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-text" onClick={() => setResolved(null)}>
                Otro enlace
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={busy || !variant || !!twin}
                onClick={save}
              >
                {busy ? 'Guardando…' : 'Seguir precio'}
              </button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
