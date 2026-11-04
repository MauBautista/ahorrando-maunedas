import type { HaTokenCreated, HaTokenItem, HaTokensResponse } from '@maunedas/shared/api/ha';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useApi } from '../../lib/context';
import { formatDate } from '../../lib/format';
import { subjectName } from '../tracking/labels';
import type { ChosenVariant } from '../tracking/presetVariant';
import { VariantPicker } from '../tracking/VariantPicker';
import { haConfig } from './haConfig';

const TOKENS_KEY = ['admin-ha-tokens'];

/**
 * W-23 (T-308, 03 §13): read-only tokens for Home Assistant. A token is shown once, when it is created, since the
 * Worker keeps only its hash; revoking it stops it at once. Below, the configuration for one variant.
 */
export function HomeAssistantPage() {
  const api = useApi();
  const queryClient = useQueryClient();
  const tokens = useQuery({
    queryKey: TOKENS_KEY,
    queryFn: () => api.get<HaTokensResponse>('/v1/admin/ha-tokens'),
  });
  const [name, setName] = useState('');
  const [created, setCreated] = useState<HaTokenCreated | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [variant, setVariant] = useState<ChosenVariant | null>(null);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setProblem('Escribe un nombre, por ejemplo «Home Assistant de la casa».');
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      setCreated(await api.post<HaTokenCreated>('/v1/admin/ha-tokens', { name: name.trim() }));
      setName('');
      await queryClient.invalidateQueries({ queryKey: TOKENS_KEY });
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'No se pudo crear.');
    } finally {
      setBusy(false);
    }
  }

  async function revoke(t: HaTokenItem) {
    if (!window.confirm(`¿Revocar «${t.name}»? Home Assistant dejará de leer los precios con él.`)) return;
    setProblem(null);
    try {
      await api.del(`/v1/admin/ha-tokens/${t.id}`);
      if (created?.id === t.id) setCreated(null);
      await queryClient.invalidateQueries({ queryKey: TOKENS_KEY });
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'No se pudo revocar.');
    }
  }

  const items = tokens.data?.items ?? [];
  const chosen = variant ? { variant_id: variant.variant_id, name: subjectName(variant) } : null;
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-title">Home Assistant</h1>
      <p className="text-on-surface-variant">
        Home Assistant puede leer el precio actual, el mínimo histórico y la existencia de una presentación
        con un token de solo lectura: no puede cambiar nada.
      </p>
      <form onSubmit={create} className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          Nombre del token
          <input className="field" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </label>
        <button type="submit" className="btn-primary" disabled={busy}>
          Crear token
        </button>
      </form>
      {problem && (
        <p role="alert" className="text-error">
          {problem}
        </p>
      )}
      {created && (
        <div role="status" className="flex flex-col gap-2 rounded-xl border border-primary p-4">
          <p>
            Token «{created.name}». Cópialo ahora: <strong>no se volverá a mostrar</strong>.
          </p>
          <code className="break-all rounded bg-surface-variant p-2">{created.token}</code>
        </div>
      )}
      {tokens.isError && (
        <p role="alert" className="text-error">
          {tokens.error.message}
        </p>
      )}
      {tokens.isSuccess && items.length === 0 && (
        <p className="text-on-surface-variant">Aún no hay tokens.</p>
      )}
      {items.length > 0 && (
        <ul className="flex flex-col gap-2">
          {items.map((t) => (
            <li
              key={t.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-outline/30 p-3"
            >
              <div className="flex flex-col">
                <span className="font-medium">{t.name}</span>
                <span className="text-label text-on-surface-variant">
                  Creado por {t.created_by_name} el {formatDate(t.created_at)} ·{' '}
                  {t.last_used_at ? `último uso el ${formatDate(t.last_used_at)}` : 'sin usar'}
                  {t.revoked_at && ` · revocado el ${formatDate(t.revoked_at)}`}
                </span>
              </div>
              {!t.revoked_at && (
                <button type="button" className="btn-text text-error" onClick={() => revoke(t)}>
                  Revocar
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <h2 className="text-title">Configuración en Home Assistant</h2>
      <p className="text-on-surface-variant">
        Elige una presentación para armar el sensor; la lista completa con sus ids está en{' '}
        <code>/ha/v1/variants</code>.
      </p>
      <VariantPicker value={variant} onChange={setVariant} />
      <pre
        aria-label="Configuración de Home Assistant"
        className="overflow-x-auto rounded-xl bg-surface-variant p-3 text-label"
      >
        {haConfig(window.location.origin, chosen)}
      </pre>
    </section>
  );
}
