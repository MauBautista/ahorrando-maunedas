import type { CfdiImportResponse, CfdiPreviewResponse, CfdiRejection } from '@maunedas/shared/api/cfdi';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Dialog } from '../../components/Dialog';
import { ApiError } from '../../lib/api';
import { useApi } from '../../lib/context';
import { formatDate, formatMoney } from '../../lib/format';
import { useLookups } from '../../lib/lookups';
import { CFDI_REJECTION_TEXT } from './cfdi';

function problemOf(e: unknown): string {
  if (e instanceof ApiError && e.code === 'UNSUPPORTED_CFDI') {
    const reason = (e.details as { reason?: CfdiRejection } | undefined)?.reason;
    if (reason && reason in CFDI_REJECTION_TEXT) return CFDI_REJECTION_TEXT[reason];
  }
  return e instanceof Error ? e.message : 'No se pudo leer la factura.';
}

/**
 * W-03 "Importar factura" (T-307, 03 §14): the CFDI's XML is read by the Worker without writing; with the store chosen
 * (suggested by the issuer), it becomes a draft purchase that opens in the editor to review, link and confirm.
 */
export function CfdiImportDialog({ onClose }: { onClose: () => void }) {
  const api = useApi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: lookups } = useLookups();
  const [xml, setXml] = useState<string | null>(null);
  const [preview, setPreview] = useState<CfdiPreviewResponse | null>(null);
  const [storeId, setStoreId] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [already, setAlready] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function read(file: File | undefined) {
    setPreview(null);
    setProblem(null);
    setAlready(null);
    if (!file) return;
    setBusy(true);
    try {
      const text = await file.text();
      const answer = await api.post<CfdiPreviewResponse>('/v1/purchases/cfdi/preview', { xml: text });
      setXml(text);
      setPreview(answer);
      setStoreId(answer.store_id ?? '');
      setAlready(answer.imported_purchase_id);
    } catch (e) {
      setProblem(problemOf(e));
    } finally {
      setBusy(false);
    }
  }

  async function importIt() {
    if (!xml || !preview) return;
    if (!storeId) {
      setProblem('Elige la tienda de la factura.');
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const done = await api.post<CfdiImportResponse>('/v1/purchases/cfdi', { xml, store_id: storeId });
      await queryClient.invalidateQueries({ queryKey: ['purchases'] });
      navigate(`/compras/${done.purchase_id}/editar`);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'CFDI_ALREADY_IMPORTED') {
        setAlready((e.details as { purchase_id: string }).purchase_id);
      } else {
        setProblem(problemOf(e));
      }
    } finally {
      setBusy(false);
    }
  }

  const stores = lookups?.stores ?? [];
  return (
    <Dialog title="Importar factura (CFDI)" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p className="text-on-surface-variant">
          Elige el archivo XML de la factura. Las líneas quedan con lo que pagaste, impuestos incluidos, y la
          compra queda en borrador para revisarla.
        </p>
        <label className="flex flex-col gap-1">
          Archivo XML
          <input
            type="file"
            accept=".xml,application/xml,text/xml"
            disabled={busy}
            onChange={(e) => read(e.target.files?.[0])}
          />
        </label>
        {preview && (
          <div role="status" className="flex flex-col gap-1 rounded-xl border border-outline/30 p-3">
            <p className="font-medium">
              {preview.emisor.name ?? preview.emisor.rfc} · {formatDate(preview.issued_at)}
            </p>
            <p>
              Total {formatMoney(preview.total_cents)} · {preview.lines.length}{' '}
              {preview.lines.length === 1 ? 'línea' : 'líneas'}
              {preview.linked > 0 &&
                ` (${preview.linked} ya ${preview.linked === 1 ? 'vinculada' : 'vinculadas'})`}
            </p>
          </div>
        )}
        {already && (
          <p role="alert" className="text-error">
            Esta factura ya se importó.{' '}
            <Link to={`/compras/${already}`} className="underline">
              Ver la compra
            </Link>
          </p>
        )}
        {preview && !already && (
          <label className="flex flex-col gap-1">
            Tienda
            <select className="field" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
              <option value="">Elige la tienda</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {problem && (
          <p role="alert" className="text-error">
            {problem}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-text" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={busy || !preview || !!already}
            onClick={importIt}
          >
            Importar
          </button>
        </div>
      </div>
    </Dialog>
  );
}
