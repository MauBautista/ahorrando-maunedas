import { roundHalfUp } from './rounding';

export type Measure = 'mass' | 'volume' | 'count';
export type DisplayUnit = 'kg' | '100g' | 'L' | '100ml' | 'pz';

/** Base units: g (mass), ml (volume), pz (count). ARQUITECTURA §3.1. */
export const BASE_PER_DISPLAY: Readonly<Record<DisplayUnit, { measure: Measure; base: number }>> = {
  kg: { measure: 'mass', base: 1000 },
  '100g': { measure: 'mass', base: 100 },
  L: { measure: 'volume', base: 1000 },
  '100ml': { measure: 'volume', base: 100 },
  pz: { measure: 'count', base: 1 },
};

const DEFAULT_DISPLAY_UNIT: Readonly<Record<Measure, DisplayUnit>> = {
  mass: 'kg',
  volume: 'L',
  count: 'pz',
};

/** Cents per g / ml / pz, not rounded. Throws if the base content is not positive. */
export function centsPerBase(
  paidCents: number,
  quantity: number,
  unitAmount: number,
  packCount: number,
): number {
  const base = quantity * unitAmount * packCount;
  if (!(base > 0)) throw new RangeError('Contenido base inválido');
  return paidCents / base;
}

/** Cents per display unit, rounded half-up. Throws if the display unit does not apply to the measure. */
export function displayCents(cpb: number, measure: Measure, unit: DisplayUnit): number {
  const d = BASE_PER_DISPLAY[unit];
  if (d.measure !== measure) throw new TypeError(`${unit} no aplica a ${measure}`);
  return roundHalfUp(cpb * d.base);
}

/** Display unit suggested for a measure (S-09): kg, L or pz. */
export function defaultDisplayUnit(measure: Measure): DisplayUnit {
  return DEFAULT_DISPLAY_UNIT[measure];
}
