import { addDays, monthStart, zonedEpoch } from '../../lib/dates';

export const PERIODS = [
  { value: '', label: 'Todas las fechas' },
  { value: 'este-mes', label: 'Este mes' },
  { value: 'mes-pasado', label: 'Mes pasado' },
  { value: 'tres-meses', label: 'Últimos 3 meses' },
  { value: 'fechas', label: 'Elegir fechas…' },
] as const;

/** The inclusive interval of a period (T59): whole days of Mexico City; "Últimos 3 meses" is this one and the two before. */
export function periodRange(
  period: string,
  now: number,
  from: string,
  to: string,
): { from?: number; to?: number } {
  const end = (back: number) => monthStart(now, back) - 1;
  switch (period) {
    case 'este-mes':
      return { from: monthStart(now), to: end(-1) };
    case 'mes-pasado':
      return { from: monthStart(now, 1), to: end(0) };
    case 'tres-meses':
      return { from: monthStart(now, 2), to: end(-1) };
    case 'fechas':
      return {
        from: from ? zonedEpoch(from) : undefined,
        to: to ? zonedEpoch(addDays(to, 1)) - 1 : undefined,
      };
    default:
      return {};
  }
}
