import type { AiBudget } from '@maunedas/shared/api/admin';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '../../lib/context';

const usd = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});
const MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];
const PURPOSE: Record<keyof AiBudget['by_purpose'], string> = {
  receipt: 'Tickets',
  image_edit: 'Edición de fotos',
  other: 'Otros',
};

/** "USD 1.2345" as es-MX writes dollars. */
function dollars(v: number): string {
  return usd.format(v);
}

/**
 * W-13 (06 §3, 09 §2): this month's AI spending (Mexico City) against its cap, by purpose and calls, and the
 * banner once the soft limit is crossed. Past the cap, AI calls are refused until next month (402 AI_BUDGET_EXCEEDED).
 */
export function AiSpendPage() {
  const api = useApi();
  const budget = useQuery({
    queryKey: ['ai-budget'],
    queryFn: () => api.get<AiBudget>('/v1/admin/ai-budget'),
  });
  if (budget.isPending)
    return (
      <p role="status" className="text-on-surface-variant">
        Cargando…
      </p>
    );
  if (budget.isError)
    return (
      <p role="alert" className="text-error">
        {budget.error.message}
      </p>
    );
  const b = budget.data;
  const [year, month] = b.month.split('-').map(Number);
  const pct = b.budget_usd > 0 ? Math.min(100, Math.round((b.spent_usd / b.budget_usd) * 100)) : 0;
  return (
    <section className="flex max-w-2xl flex-col gap-4">
      <h1 className="text-title">Gasto de IA</h1>
      <p className="text-on-surface-variant">
        {MONTHS[month! - 1]} de {year}
      </p>
      {b.soft_limit_reached && (
        <p role="alert" className="rounded-lg border border-warning p-3 text-warning">
          El gasto de este mes ya pasó el {b.soft_limit_pct} % del tope. Al llegar al tope, la IA se pausa
          hasta el mes siguiente.
        </p>
      )}
      <div className="flex flex-col gap-2">
        <p className="text-title tabular-nums">
          {dollars(b.spent_usd)} de {dollars(b.budget_usd)}
        </p>
        <div
          role="progressbar"
          aria-label="Gasto del mes contra el tope"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          className="h-3 overflow-hidden rounded-full bg-surface-variant"
        >
          <div
            className={`h-full ${b.soft_limit_reached ? 'bg-warning' : 'bg-primary'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="text-label text-on-surface-variant">
          {pct} % del tope · {b.calls === 1 ? '1 llamada' : `${b.calls} llamadas`}
        </p>
      </div>
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 rounded-xl bg-surface-variant p-3">
        {(Object.keys(PURPOSE) as Array<keyof typeof PURPOSE>).map((k) => (
          <div key={k} className="contents">
            <dt>{PURPOSE[k]}</dt>
            <dd className="text-right tabular-nums">{dollars(b.by_purpose[k])}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
