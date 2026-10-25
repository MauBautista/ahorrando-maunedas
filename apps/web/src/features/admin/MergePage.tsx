import type { MergeResponse } from '@maunedas/shared/api/admin';
import type { ProductsResponse, VariantSearchItem } from '@maunedas/shared/api/catalog';
import type { Measure } from '@maunedas/shared/pricing/units';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Dialog } from '../../components/Dialog';
import { useApi } from '../../lib/context';
import { useDebounced } from '../../lib/useDebounced';
import { mergeProblem, movedText } from './merge';

type Kind = 'product' | 'variant';
interface Pick {
  id: string;
  name: string;
  measure: Measure | null;
}

/**
 * W-12 (06 §3, RF-CAT-07): merge a duplicate product or variant into the one that stays, with Android's texts. The
 * preview counts what would move (`dry_run`, 03 §12) before confirming; variants of another measure are not offered,
 * since the server refuses them.
 */
export function MergePage() {
  const api = useApi();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<Kind>('product');
  const [source, setSource] = useState<Pick | null>(null);
  const [target, setTarget] = useState<Pick | null>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const body = source && target ? { kind, source_id: source.id, target_id: target.id } : null;
  const preview = useQuery({
    queryKey: ['merge-preview', body],
    enabled: !!body,
    // A preview is only valid for the rows as they are now.
    staleTime: 0,
    gcTime: 0,
    retry: false,
    queryFn: () => api.post<MergeResponse>('/v1/admin/merge', { ...body, dry_run: true }),
  });

  function reset(next: Kind = kind) {
    setKind(next);
    setSource(null);
    setTarget(null);
    setProblem(null);
  }

  async function merge() {
    if (!body || !source || !target) return;
    setAsking(false);
    setBusy(true);
    try {
      const { moved } = await api.post<MergeResponse>('/v1/admin/merge', body);
      await queryClient.invalidateQueries();
      const what = movedText(moved);
      setDone(`Listo: «${source.name}» se fusionó en «${target.name}»${what ? ` (${what})` : ''}.`);
      reset();
    } catch (e) {
      setProblem(mergeProblem(e));
    } finally {
      setBusy(false);
    }
  }

  const confirmText =
    source && target
      ? kind === 'product'
        ? `¿Fusionar «${source.name}» en «${target.name}»? Sus presentaciones, fotos y etiquetas pasan a «${target.name}», y «${source.name}» se elimina. No se puede deshacer.`
        : `¿Fusionar «${source.name}» en «${target.name}»? Sus códigos, compras y precios pasan a «${target.name}», y «${source.name}» se elimina. Fusiona solo presentaciones iguales: los precios por unidad se recalculan con el contenido de «${target.name}». No se puede deshacer.`
      : '';

  return (
    <section className="flex max-w-2xl flex-col gap-4">
      <h1 className="text-title">Fusionar duplicados</h1>
      {done && (
        <p role="status" className="rounded-lg bg-surface-variant p-2">
          {done}
        </p>
      )}
      <fieldset className="flex flex-wrap gap-2">
        <legend className="mb-1 text-label">Qué fusionar</legend>
        {(
          [
            ['product', 'Productos'],
            ['variant', 'Presentaciones'],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className={`tab border border-outline/40 ${kind === value ? 'tab-active' : ''}`}>
            <input
              type="radio"
              className="sr-only"
              name="merge-kind"
              checked={kind === value}
              onChange={() => {
                reset(value);
                setDone(null);
              }}
            />
            {label}
          </label>
        ))}
      </fieldset>
      <Chooser
        key={`source-${kind}`}
        label="El duplicado (se elimina)"
        kind={kind}
        picked={source}
        onPick={(p) => {
          setSource(p);
          if (p && target && (p.id === target.id || (kind === 'variant' && p.measure !== target.measure)))
            setTarget(null);
          setProblem(null);
          setDone(null);
        }}
      />
      {source && (
        <Chooser
          key={`target-${kind}`}
          label="El que se queda"
          kind={kind}
          picked={target}
          except={source}
          onPick={(p) => {
            setTarget(p);
            setProblem(null);
          }}
        />
      )}
      {body && preview.isPending && (
        <p role="status" className="text-on-surface-variant">
          Revisando…
        </p>
      )}
      {body && preview.isError && (
        <p role="alert" className="text-error">
          {mergeProblem(preview.error)}
        </p>
      )}
      {body && preview.data && (
        <div className="flex flex-col gap-3 rounded-xl bg-surface-variant p-3">
          <p>
            {movedText(preview.data.moved)
              ? `Pasarán a «${target!.name}»: ${movedText(preview.data.moved)}.`
              : `No hay nada que mover; solo se elimina «${source!.name}».`}
          </p>
          <button
            type="button"
            className="btn-primary self-end"
            disabled={busy}
            onClick={() => setAsking(true)}
          >
            Fusionar
          </button>
        </div>
      )}
      {problem && (
        <p role="alert" className="text-error">
          {problem}
        </p>
      )}
      {asking && (
        <Dialog title="Fusionar" onClose={() => setAsking(false)}>
          <p>{confirmText}</p>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className="btn-outline" onClick={() => setAsking(false)}>
              Cancelar
            </button>
            <button type="button" className="btn-primary" onClick={() => void merge()}>
              Fusionar
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
}

/** A product or variant found by its words (or a code), shown with its brand or its product. */
function Chooser({
  label,
  kind,
  picked,
  except,
  onPick,
}: {
  label: string;
  kind: Kind;
  picked: Pick | null;
  except?: Pick;
  onPick: (p: Pick | null) => void;
}) {
  const api = useApi();
  const [query, setQuery] = useState('');
  const q = useDebounced(query.trim());
  const found = useQuery({
    queryKey: ['merge-search', kind, q],
    enabled: q !== '' && !picked,
    queryFn: async (): Promise<Pick[]> => {
      if (kind === 'product') {
        const { items } = await api.get<ProductsResponse>(
          `/v1/products?${new URLSearchParams({ q, limit: '10' })}`,
        );
        return items.map((p) => ({
          id: p.id,
          name: p.brand ? `${p.name} · ${p.brand}` : p.name,
          measure: null,
        }));
      }
      const { items } = await api.get<{ items: VariantSearchItem[] }>(
        `/v1/search/variants?${new URLSearchParams({ q, limit: '10' })}`,
      );
      return items.map((v) => ({
        id: v.variant_id,
        name: `${v.product_name} · ${v.variant_label}`,
        measure: v.measure,
      }));
    },
  });
  const options = (found.data ?? []).filter(
    (p) => p.id !== except?.id && (kind === 'product' || !except || p.measure === except.measure),
  );

  return (
    <div className="flex flex-col gap-2">
      <span className="text-label">{label}</span>
      {picked ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-outline/30 p-2">
          <span className="font-medium">{picked.name}</span>
          <button type="button" className="btn-text" onClick={() => onPick(null)}>
            Cambiar
          </button>
        </div>
      ) : (
        <>
          <input
            type="search"
            aria-label={`Buscar ${label.toLowerCase()}`}
            placeholder="Buscar por nombre, marca o código"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="field"
          />
          {found.data && options.length === 0 && (
            <p className="text-on-surface-variant">No hay con qué fusionar.</p>
          )}
          <ul className="flex flex-col gap-1">
            {options.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className="w-full rounded-lg p-2 text-left hover:bg-surface-variant"
                  onClick={() => {
                    onPick(p);
                    setQuery('');
                  }}
                >
                  {p.name}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
