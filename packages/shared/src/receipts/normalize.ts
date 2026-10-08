import { foldAccents } from '../text/fold';

const LEADING_CODE = /^\d{8,14}\s+/;
const TRAILING_CODE = /\s+\d{8,14}$/;
const QUANTITY_PREFIX = /^\d+(?:\.\d+)?\s*(?:X|@|\*)\s+/;
const TRAILING_PRICE = /\s+\$?\d+[.,]\d{2}$/;
const SCALE_WEIGHT = /\b\d+\.\d{3}\s*KG\b/g;
const NOT_ALLOWED = /[^A-Z0-9 %.]/g;
const DOT_NOT_BETWEEN_DIGITS = /(?<!\d)\.|\.(?!\d)/g;

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * `receipt_aliases.raw_text_norm` for a receipt line (SDD 09 §5.1):
 * "2 @ PAN BIMBO BLANCO 14.25 28.50" → "PAN BIMBO BLANCO".
 */
export function normalizeReceiptText(raw: string): string {
  let s = collapse(foldAccents(raw).toUpperCase()); // 1
  s = s.replace(LEADING_CODE, '').replace(TRAILING_CODE, ''); // 2
  s = s.replace(QUANTITY_PREFIX, ''); // 3
  s = s.replace(TRAILING_PRICE, '').replace(TRAILING_PRICE, ''); // 4: up to two prices
  s = s.replace(SCALE_WEIGHT, ' '); // 5
  s = s.replace(NOT_ALLOWED, ' ').replace(DOT_NOT_BETWEEN_DIGITS, ''); // 6
  return collapse(s); // 7
}
