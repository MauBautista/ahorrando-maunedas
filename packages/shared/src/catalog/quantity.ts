import type { Measure } from '../pricing/units';
import { roundHalfUp } from '../pricing/rounding';
import { foldAccents } from '../text/fold';

export interface ParsedQuantity {
  measure: Measure;
  unit_amount: number;
  pack_count: number;
}

interface UnitDef {
  measure: Measure;
  factor: number;
  /** oz and fl oz are rounded to whole base units (SDD 10 §2.2). */
  integer?: boolean;
}

const UNITS: Record<string, UnitDef> = {
  mg: { measure: 'mass', factor: 0.001 },
  g: { measure: 'mass', factor: 1 },
  gr: { measure: 'mass', factor: 1 },
  grs: { measure: 'mass', factor: 1 },
  gramos: { measure: 'mass', factor: 1 },
  kg: { measure: 'mass', factor: 1000 },
  kgs: { measure: 'mass', factor: 1000 },
  kilo: { measure: 'mass', factor: 1000 },
  kilos: { measure: 'mass', factor: 1000 },
  oz: { measure: 'mass', factor: 28.3495, integer: true },
  ml: { measure: 'volume', factor: 1 },
  mililitros: { measure: 'volume', factor: 1 },
  cl: { measure: 'volume', factor: 10 },
  l: { measure: 'volume', factor: 1000 },
  lt: { measure: 'volume', factor: 1000 },
  lts: { measure: 'volume', factor: 1000 },
  litro: { measure: 'volume', factor: 1000 },
  litros: { measure: 'volume', factor: 1000 },
  'fl oz': { measure: 'volume', factor: 29.5735, integer: true },
  pz: { measure: 'count', factor: 1 },
  pza: { measure: 'count', factor: 1 },
  pzas: { measure: 'count', factor: 1 },
  pieza: { measure: 'count', factor: 1 },
  piezas: { measure: 'count', factor: 1 },
  u: { measure: 'count', factor: 1 },
  unidades: { measure: 'count', factor: 1 },
  rollos: { measure: 'count', factor: 1 },
  tabletas: { measure: 'count', factor: 1 },
  capsulas: { measure: 'count', factor: 1 },
  sobres: { measure: 'count', factor: 1 },
};

// Longest first so "fl oz" wins over "oz" and "litros" over "l".
const UNIT = Object.keys(UNITS)
  .sort((a, b) => b.length - a.length)
  .map((u) => u.replace(' ', '\\s*'))
  .join('|');
const NUM = String.raw`\d+(?:\.\d+)?`;
const PACK_FIRST = new RegExp(String.raw`(?<![\d.])(\d+)\s*x\s*(${NUM})\s*(${UNIT})(?![a-z])`);
const PACK_LAST = new RegExp(String.raw`(?<![\d.])(${NUM})\s*(${UNIT})(?![a-z])\s*x\s*(\d+)(?![\d.])`);
const SINGLE = new RegExp(String.raw`(?<![\d.])(${NUM})\s*(${UNIT})(?![a-z])`, 'g');

const round3 = (x: number) => Math.round(x * 1000) / 1000;

function toBase(amount: string, unitText: string): { measure: Measure; amount: number } | null {
  const def = UNITS[unitText.replace(/\s+/g, ' ')];
  if (!def) return null;
  const value = Number(amount) * def.factor;
  const rounded = def.integer ? roundHalfUp(value) : round3(value);
  return rounded > 0 ? { measure: def.measure, amount: rounded } : null;
}

function build(amount: string, unitText: string, pack: string): ParsedQuantity | null {
  const base = toBase(amount, unitText);
  const packCount = Number(pack);
  if (!base || !(packCount >= 1)) return null;
  return { measure: base.measure, unit_amount: base.amount, pack_count: packCount };
}

/**
 * Interprets the content text of open catalogs (SDD 10 §2.2): "6 x 1 l" → 6 × 1000 ml.
 * Patterns in order: "N x Q unit", "Q unit x N", "Q unit" (metric preferred over oz). Null if unknown.
 */
export function parseQuantity(text: string | null | undefined): ParsedQuantity | null {
  if (!text) return null;
  const t = foldAccents(text)
    .toLowerCase()
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/[×*]/g, 'x');

  const first = PACK_FIRST.exec(t);
  if (first) return build(first[2]!, first[3]!, first[1]!);
  const last = PACK_LAST.exec(t);
  if (last) return build(last[1]!, last[2]!, last[3]!);

  const singles = [...t.matchAll(SINGLE)];
  const preferred = singles.find((m) => !UNITS[m[2]!.replace(/\s+/g, ' ')]?.integer) ?? singles[0];
  return preferred ? build(preferred[1]!, preferred[2]!, '1') : null;
}

const fmt = (x: number) => String(round3(x));

/** Suggested variant label: "1 L", "946 ml", "6 × 1 L", "1.5 L", "30 pz". */
export function suggestVariantLabel(q: ParsedQuantity): string {
  const a = q.unit_amount;
  let base: string;
  if (q.measure === 'mass') base = a >= 1000 ? `${fmt(a / 1000)} kg` : `${fmt(a)} g`;
  else if (q.measure === 'volume') base = a >= 1000 ? `${fmt(a / 1000)} L` : `${fmt(a)} ml`;
  else base = `${fmt(a)} pz`;
  return q.pack_count > 1 ? `${q.pack_count} × ${base}` : base;
}
