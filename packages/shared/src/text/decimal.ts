// Typed money and quantities (05 §7), the same rule as Kotlin `DecimalText` in core:model: a separator that appears
// once is the decimal one; repeated, it groups thousands; with both, the rightmost is the decimal one. No floats for
// money (CLAUDE.md rule 1).

const NOISE = /[\s\u00A0$]/g;
const DIGITS = /^\d+$/;

/** The whole and fraction digits of [input], or null when it is not a number with at most [maxDecimals]. */
function decimalParts(input: string, maxDecimals: number): { whole: string; fraction: string } | null {
  const s = input.replace(NOISE, '');
  if (s === '') return null;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  const count = (c: string) => s.split(c).length - 1;
  let decimalAt = -1;
  if (lastDot >= 0 && lastComma >= 0) decimalAt = Math.max(lastDot, lastComma);
  else if (lastDot >= 0) decimalAt = count('.') === 1 ? lastDot : -1;
  else if (lastComma >= 0) decimalAt = count(',') === 1 ? lastComma : -1;
  const whole = (decimalAt >= 0 ? s.slice(0, decimalAt) : s).replace(/[.,]/g, '');
  const fraction = decimalAt >= 0 ? s.slice(decimalAt + 1) : '';
  if (!DIGITS.test(whole || '0') || (fraction !== '' && !DIGITS.test(fraction))) return null;
  if (fraction.length > maxDecimals) return null;
  return { whole: whole || '0', fraction };
}

/** Cents of a typed price: "28.5", "28,5", "$1,234.50" or "1.234,50"; at most 2 decimals, not negative. */
export function parseCents(input: string): number | null {
  const parts = decimalParts(input, 2);
  if (!parts) return null;
  return Number(parts.whole) * 100 + Number(parts.fraction.padEnd(2, '0'));
}

/** "28.50" for 2850: the text a money field starts with. */
export function plainCents(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

/** A typed positive amount ("0.845", "1,5", "2") with up to 3 decimals; null otherwise. */
export function parseAmount(input: string): number | null {
  const parts = decimalParts(input, 3);
  if (!parts) return null;
  const value = Number(`${parts.whole}.${parts.fraction || '0'}`);
  return value > 0 ? value : null;
}
