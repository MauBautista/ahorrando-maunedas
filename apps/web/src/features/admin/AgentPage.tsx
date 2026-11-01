import type { AdminAgentResponse } from '@maunedas/shared/api/agent';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '../../lib/context';
import { timeKey } from '../../lib/dates';
import { agoTime, formatDate } from '../../lib/format';

const STORES: Record<string, string> = { amazon_mx: 'Amazon', sams_mx: 'Sam’s Club', costco_mx: 'Costco' };

/** What the agent reports in `info` (07 §5.1, §10); older agents may lack any of it. */
interface AgentInfo {
  outbox?: number;
  due?: number;
  mem_mb?: number;
  load1?: number;
  blocked?: string[];
  last_error?: string | null;
  backup?: {
    mirror_ok?: boolean;
    mirror_error?: string | null;
    mirror_at?: number;
    mirror_rows?: number;
    dump_ok?: boolean;
    dump_error?: string | null;
    dump_at?: number;
    dump_file?: string;
    dump_bytes?: number;
    photos_ok?: boolean | null;
    photos_error?: string | null;
    photos_at?: number;
    photos_files?: number;
  } | null;
}

const when = (at: number) => `${formatDate(at)}, ${timeKey(at)}`;
const kb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024))} KB`;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-4">
      <dt className="text-on-surface-variant">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** One backup job: done (with when and what), failed (with why) or not run yet. */
function Job({
  ok,
  error,
  at,
  done,
}: {
  ok?: boolean | null;
  error?: string | null;
  at?: number;
  done: string;
}) {
  if (ok === true) return <span>{at ? `${done} · ${when(at)}` : done}</span>;
  if (ok === false) return <span className="text-error">Falló: {error}</span>;
  if (error) return <span className="text-warning">{error}</span>;
  return <span className="text-on-surface-variant">Aún no corre</span>;
}

/**
 * W-22 (admin, 03 §12): whether the home server is reporting, what it has pending, the stores blocking it, its
 * last error and the backups (07 §10). Refreshed every minute, the agent's pace.
 */
export function AgentPage() {
  const api = useApi();
  const agent = useQuery({
    queryKey: ['admin-agent'],
    queryFn: () => api.get<AdminAgentResponse>('/v1/admin/agent'),
    refetchInterval: 60_000,
  });
  if (agent.isPending)
    return (
      <p role="status" className="text-on-surface-variant">
        Cargando…
      </p>
    );
  if (agent.isError)
    return (
      <p role="alert" className="text-error">
        {agent.error.message}
      </p>
    );
  const a = agent.data;
  const now = agent.dataUpdatedAt;
  const info = (a.status?.info ?? {}) as AgentInfo;
  const b = info.backup ?? {};
  return (
    <section className="flex max-w-2xl flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-title">Servidor casero</h1>
        <span
          className={`rounded-full border px-2 text-label ${a.online ? 'border-primary text-primary' : 'border-error text-error'}`}
        >
          {a.online ? 'En línea' : 'Sin conexión'}
        </span>
      </div>
      {!a.status ? (
        <p className="text-on-surface-variant">El servidor casero todavía no se ha conectado.</p>
      ) : (
        <>
          <p className="text-on-surface-variant">
            {a.status.last_heartbeat_at
              ? `Último reporte ${agoTime(a.status.last_heartbeat_at, now)} (${when(a.status.last_heartbeat_at)})`
              : 'Sin reportes'}
            {a.status.agent_version && ` · versión ${a.status.agent_version}`}
          </p>
          {!a.online && (
            <p role="alert" className="rounded-lg border border-error p-3 text-error">
              Mientras no se conecte, los precios en línea no se revisan. Revisa que el contenedor esté
              corriendo.
            </p>
          )}
          <dl className="flex flex-col gap-1 rounded-xl border border-outline/30 p-4">
            <Row label="Enlaces por revisar">{info.due ?? 0}</Row>
            <Row label="Resultados por enviar">{info.outbox ?? 0}</Row>
            <Row label="Enlaces bloqueados">{a.blocked_listings}</Row>
            <Row label="Enlaces con fallas">{a.failing_listings}</Row>
            <Row label="Tiendas bloqueando">
              {info.blocked?.length ? info.blocked.map((s) => STORES[s] ?? s).join(', ') : 'Ninguna'}
            </Row>
            <Row label="Fotos por procesar">{a.queued_image_jobs}</Row>
            <Row label="Memoria">{info.mem_mb !== undefined ? `${Math.round(info.mem_mb)} MB` : '—'}</Row>
            <Row label="Carga">{info.load1 ?? '—'}</Row>
            <Row label="Último error">{info.last_error || 'Ninguno'}</Row>
          </dl>
          <h2 className="text-title">Respaldos</h2>
          <dl className="flex flex-col gap-1 rounded-xl border border-outline/30 p-4">
            <Row label="Copia diaria de la base">
              <Job
                ok={b.mirror_ok}
                error={b.mirror_error}
                at={b.mirror_at}
                done={`${b.mirror_rows ?? 0} filas al día`}
              />
            </Row>
            <Row label="Volcado semanal">
              <Job
                ok={b.dump_ok}
                error={b.dump_error}
                at={b.dump_at}
                done={b.dump_file ? `${b.dump_file} (${kb(b.dump_bytes ?? 0)})` : 'Listo'}
              />
            </Row>
            <Row label="Fotos">
              <Job
                ok={b.photos_ok}
                error={b.photos_error}
                at={b.photos_at}
                done={`${b.photos_files ?? 0} archivos`}
              />
            </Row>
          </dl>
        </>
      )}
    </section>
  );
}
