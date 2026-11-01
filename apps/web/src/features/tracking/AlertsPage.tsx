import type { AlertRuleItem } from '@maunedas/shared/api/alerts';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Dialog } from '../../components/Dialog';
import { useApi } from '../../lib/context';
import { timeKey } from '../../lib/dates';
import { formatDate } from '../../lib/format';
import { push, touchedAt } from '../../lib/sync';
import { useMe } from '../auth/useSession';
import { CatalogTabs } from '../catalog/CatalogTabs';
import { conflictMessage } from '../catalog/editor/conflicts';
import { DELIVERY_LABEL, ruleText, subjectName } from './labels';
import { useAlertEvents, useRules } from './queries';
import { RuleDialog } from './RuleDialog';
import { usePresetVariant } from './presetVariant';

/**
 * W-21 (S-22, S-23): my alert rules, to create, edit, pause or remove, and the alerts that fired, newest first. The
 * notifications themselves reach the Android app; the web keeps the history. `?producto=&variante=` shows and
 * preselects one variant.
 */
export function AlertsPage() {
  const api = useApi();
  const queryClient = useQueryClient();
  const { data: me } = useMe();
  const [params] = useSearchParams();
  const variantId = params.get('variante');
  const preset = usePresetVariant(params.get('producto'), variantId);
  const rules = useRules(variantId);
  const events = useAlertEvents();
  const [editing, setEditing] = useState<AlertRuleItem | 'new' | null>(null);
  const [removing, setRemoving] = useState<AlertRuleItem | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['alert-rules'] });

  async function write(row: Record<string, unknown>) {
    setProblem(null);
    try {
      const message = conflictMessage((await push(api, [{ table: 'alert_rules', row }])).conflicts);
      if (message) setProblem(message);
      await refresh();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    }
  }

  const items = rules.data?.items ?? [];
  const history = events.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <section className="flex flex-col gap-4">
      <CatalogTabs />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-title">Alertas de precio</h1>
        <button type="button" className="btn-primary" onClick={() => setEditing('new')} disabled={!me}>
          Nueva alerta
        </button>
      </div>
      <p className="text-on-surface-variant">
        Las alertas revisan los precios en línea que sigues. Los avisos llegan a la app de Android; aquí queda
        el historial.
      </p>
      {variantId && (
        <p className="text-on-surface-variant">
          Solo {preset ? subjectName(preset) : 'una presentación'}.{' '}
          <Link to="/alertas" className="underline">
            Ver todas
          </Link>
        </p>
      )}
      {problem && (
        <p role="alert" className="text-error">
          {problem}
        </p>
      )}

      <section className="flex flex-col gap-2" aria-labelledby="rules-title">
        <h2 id="rules-title" className="text-title">
          Mis alertas
        </h2>
        {rules.isPending && <p role="status">Cargando…</p>}
        {rules.isError && (
          <p role="alert" className="text-error">
            {rules.error.message}
          </p>
        )}
        {rules.isSuccess && items.length === 0 && (
          <p className="text-on-surface-variant">Todavía no tienes alertas.</p>
        )}
        <ul className="flex flex-col gap-2">
          {items.map((r) => (
            <li key={r.id} className="flex flex-col gap-1 rounded-xl border border-outline/30 p-4">
              <Link to={`/productos/${r.product_id}`} className="font-medium hover:underline">
                {subjectName(r)}
              </Link>
              <p>{ruleText(r)}</p>
              <p className="text-label text-on-surface-variant">
                {r.store_name ? `Solo ${r.store_name}` : 'Cualquier tienda que sigas'}
                {r.cooldown_hours > 0 && ` · Silencio de ${r.cooldown_hours} h`}
                {r.active !== 1 && ' · En pausa'}
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-text" onClick={() => setEditing(r)}>
                  Editar
                </button>
                <button
                  type="button"
                  className="btn-text"
                  onClick={() =>
                    write({ id: r.id, updated_at: touchedAt(r.updated_at), active: r.active === 1 ? 0 : 1 })
                  }
                >
                  {r.active === 1 ? 'Pausar' : 'Activar'}
                </button>
                <button type="button" className="btn-text text-error" onClick={() => setRemoving(r)}>
                  Quitar
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2" aria-labelledby="history-title">
        <h2 id="history-title" className="text-title">
          Historial
        </h2>
        {events.isSuccess && history.length === 0 && (
          <p className="text-on-surface-variant">Aún no ha saltado ninguna alerta.</p>
        )}
        {events.isError && (
          <p role="alert" className="text-error">
            {events.error.message}
          </p>
        )}
        <ul className="flex flex-col gap-2">
          {history.map((e) => (
            <li key={e.id} className="flex flex-col gap-1 rounded-xl border border-outline/30 p-4">
              <p className="font-medium">{e.title}</p>
              <p>{e.body}</p>
              <p className="text-label text-on-surface-variant">
                {formatDate(e.fired_at)}, {timeKey(e.fired_at)} · {DELIVERY_LABEL[e.delivery_status]}
              </p>
              {e.product_id && (
                <Link to={`/productos/${e.product_id}`} className="btn-text self-start">
                  Ver producto
                </Link>
              )}
            </li>
          ))}
        </ul>
        {events.hasNextPage && (
          <button
            type="button"
            className="btn-outline self-start"
            disabled={events.isFetchingNextPage}
            onClick={() => events.fetchNextPage()}
          >
            Ver más
          </button>
        )}
      </section>

      {editing && me && (
        <RuleDialog
          rule={editing === 'new' ? null : editing}
          preset={preset}
          userId={me.user.id}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await refresh();
          }}
        />
      )}
      {removing && (
        <Dialog title="¿Quitar esta alerta?" onClose={() => setRemoving(null)}>
          <p className="mb-4">
            {subjectName(removing)}: {ruleText(removing).toLowerCase()}.
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-text" onClick={() => setRemoving(null)}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                const r = removing;
                setRemoving(null);
                const now = Date.now();
                void write({ id: r.id, updated_at: touchedAt(r.updated_at, now), deleted_at: now });
              }}
            >
              Quitar
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
