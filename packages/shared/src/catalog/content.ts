// `[pack_count] × [cantidad] [unidad]` ↔ `unit_amount` in base units (RF-CAT-02, S-10), as Kotlin `Content` and
// `ContentUnit` in core:pricing.
import { roundHalfUp } from '../pricing/rounding';
import type { Measure } from '../pricing/units';

export type ContentUnit = 'g' | 'kg' | 'ml' | 'L' | 'pz';

/** What one typed unit holds in base units (g, ml, pz); pieces are counted, never split. */
export const CONTENT_UNITS: Readonly<
  Record<ContentUnit, { measure: Measure; factor: number; integer: boolean }>
> = {
  g: { measure: 'mass', factor: 1, integer: false },
  kg: { measure: 'mass', factor: 1000, integer: false },
  ml: { measure: 'volume', factor: 1, integer: false },
  L: { measure: 'volume', factor: 1000, integer: false },
  pz: { measure: 'count', factor: 1, integer: true },
};

export function contentUnitsOf(measure: Measure): ContentUnit[] {
  return (Object.keys(CONTENT_UNITS) as ContentUnit[]).filter((u) => CONTENT_UNITS[u].measure === measure);
}

/** Base units of [amount] [unit], to three decimals so 1.1 kg is 1100 g and not 1100.0000000000002. */
export function toBase(amount: number, unit: ContentUnit): number {
  return roundHalfUp(amount * CONTENT_UNITS[unit].factor * 1000) / 1000;
}

/** How the assistant shows a saved amount: kg or L from 1000 up, as `suggestVariantLabel` does. */
export function forEditing(measure: Measure, unitAmount: number): { unit: ContentUnit; amount: number } {
  if (measure === 'mass')
    return unitAmount >= 1000 ? { unit: 'kg', amount: unitAmount / 1000 } : { unit: 'g', amount: unitAmount };
  if (measure === 'volume')
    return unitAmount >= 1000 ? { unit: 'L', amount: unitAmount / 1000 } : { unit: 'ml', amount: unitAmount };
  return { unit: 'pz', amount: unitAmount };
}

/** "A granel" sells by the kilo: 1000 g in a pack of one (the rule of `VariantRowSchema`). */
export const BULK_GRAMS = 1000;

/** Label of a variant sold by weight (glossary). */
export const BULK_LABEL = 'A granel (kg)';
