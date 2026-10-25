import type { PriceSource } from '@maunedas/shared/api/catalog';
import type { DisplayUnit } from '@maunedas/shared/pricing/units';

/** Times are shown in Mexico City (CLAUDE.md rule 2). */
export const ZONE = 'America/Mexico_City';

const money = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });

/** Cents as "$1,234.50" (money is always whole cents, CLAUDE.md rule 1). */
export function formatMoney(cents: number): string {
  return money.format(cents / 100);
}

const UNIT_LABEL: Record<DisplayUnit, string> = {
  kg: 'kg',
  '100g': '100 g',
  L: 'L',
  '100ml': '100 ml',
  pz: 'pz',
};

export function unitLabel(unit: DisplayUnit): string {
  return UNIT_LABEL[unit];
}

/** "$26.50/L", as Android's `UnitPriceText`. */
export function formatUnitPrice(cents: number, unit: DisplayUnit): string {
  return `${formatMoney(cents)}/${unitLabel(unit)}`;
}

export const SOURCE_LABEL: Record<PriceSource, string> = { purchase: 'Pagado', shelf: 'Anaquel', web: 'Web' };

const dayKey = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Whole calendar days between two instants in Mexico City. */
function calendarDays(from: number, to: number): number {
  const day = (ms: number) => Date.parse(`${dayKey.format(ms)}T00:00:00Z`) / 86_400_000;
  return Math.round(day(to) - day(from));
}

/** "hoy", "ayer", "hace N días" (< 14), "hace N semanas" (< 60), "hace N meses": Android's `Dates.ago`. */
export function ago(at: number, now: number): string {
  const days = calendarDays(at, now);
  if (days <= 0) return 'hoy';
  if (days === 1) return 'ayer';
  if (days < 14) return `hace ${days} días`;
  if (days < 60) return `hace ${Math.floor(days / 7)} semanas`;
  return `hace ${Math.floor(days / 30)} meses`;
}

const shortDate = new Intl.DateTimeFormat('es-MX', {
  timeZone: ZONE,
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** "12 oct 2026". */
export function formatDate(at: number): string {
  return shortDate.format(at).replace('.', '');
}
