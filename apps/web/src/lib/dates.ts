import { ZONE } from './format';

// Calendar days and times of Mexico City (CLAUDE.md rule 2), as Android's `HouseholdTime` and `Dates`.

const parts = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function local(at: number) {
  const p = Object.fromEntries(parts.formatToParts(at).map((x) => [x.type, x.value]));
  return {
    y: Number(p.year),
    m: Number(p.month),
    d: Number(p.day),
    h: Number(p.hour),
    min: Number(p.minute),
    s: Number(p.second),
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** The day of [at] in Mexico City as "2026-10-25" (an `<input type="date">` value). */
export function dateKey(at: number): string {
  const t = local(at);
  return `${t.y}-${pad(t.m)}-${pad(t.d)}`;
}

/** The time of [at] in Mexico City as "14:05" (an `<input type="time">` value). */
export function timeKey(at: number): string {
  const t = local(at);
  return `${pad(t.h)}:${pad(t.min)}`;
}

/** Mexico City minus UTC at [at], in ms. */
function offset(at: number): number {
  const t = local(at);
  return Date.UTC(t.y, t.m - 1, t.d, t.h, t.min, t.s) - (at - (((at % 1000) + 1000) % 1000));
}

/** The instant of [date] ("2026-10-25") at [time] ("14:05") in Mexico City. */
export function zonedEpoch(date: string, time = '00:00'): number {
  const [y, m, d] = date.split('-').map(Number);
  const [h, min] = time.split(':').map(Number);
  const wall = Date.UTC(y!, m! - 1, d!, h!, min!);
  // Twice, in case the first guess crosses an offset change (Mexico City had summer time until 2022).
  return wall - offset(wall - offset(wall));
}

/** [date] moved [days] calendar days. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}

/** The first instant of the month [back] months before the one of [at] (0 = this month) in Mexico City. */
export function monthStart(at: number, back = 0): number {
  const t = local(at);
  const first = new Date(Date.UTC(t.y, t.m - 1 - back, 1)).toISOString().slice(0, 10);
  return zonedEpoch(first);
}

const time = new Intl.DateTimeFormat('es-MX', { timeZone: ZONE, hour: 'numeric', minute: '2-digit' });

/** "2:05 p.m.", the phone's default in Android (`Dates.time`). */
export function formatTime(at: number): string {
  return time.format(at).replace(/\s/g, ' ');
}

const DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
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

/** Heading of a day in a list: "Hoy", "Ayer", "martes 20 de octubre", "20 de octubre de 2025" before this year. */
export function dayTitle(at: number, now: number): string {
  const day = dateKey(at);
  const today = dateKey(now);
  if (day === today) return 'Hoy';
  if (day === addDays(today, -1)) return 'Ayer';
  const [y, m, d] = day.split('-').map(Number);
  const weekday = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
  return y === Number(today.slice(0, 4))
    ? `${DAYS[weekday]} ${d} de ${MONTHS[m! - 1]}`
    : `${d} de ${MONTHS[m! - 1]} de ${y}`;
}
