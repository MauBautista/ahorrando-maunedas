import { IMPORT_MAX_LINES } from '../api/imports';
import { grossCents } from '../pricing/purchase';
import { roundHalfUp } from '../pricing/rounding';
import { foldAccents } from '../text/fold';
import { mexicoCityMs } from '../util/time';

// Importing purchases from a spreadsheet (T-306, 03 §15): the file is read in the browser, its columns are mapped to
// these fields, and its rows become draft purchases. Money is read from the text, never through a float (rule 1).

/** A cell as read: CSV gives text; Excel also gives numbers (amounts, and dates as serial days). */
export type Cell = string | number | null;

export const IMPORT_FIELDS = [
  'date',
  'store',
  'description',
  'quantity',
  'unit_price',
  'amount',
  'ticket',
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
/** Which column (0-based) each field is read from. */
export type Mapping = Partial<Record<ImportField, number>>;

/**
 * A CSV as rows of text (RFC 4180): quoted cells may hold the delimiter, quotes doubled and line breaks. The
 * delimiter is whichever of comma, semicolon or tab appears most in the first line, outside quotes; empty rows go.
 */
export function parseCsv(text: string): string[][] {
  const body = text.replace(/^\uFEFF/, '');
  const firstLine = body.split(/\r\n|\n|\r/, 1)[0]!.replace(/"[^"]*"/g, '');
  const delimiter = [',', ';', '\t'].reduce(
    (best, d) => (firstLine.split(d).length > firstLine.split(best).length ? d : best),
    ',',
  );
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const endRow = () => {
    row.push(cell);
    if (row.some((c) => c.trim() !== '')) rows.push(row);
    row = [];
    cell = '';
  };
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (quoted) {
      if (ch !== '"') cell += ch;
      else if (body[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && body[i + 1] === '\n') i++;
      endRow();
    } else cell += ch;
  }
  if (cell !== '' || row.length > 0) endRow();
  return rows;
}

/**
 * Money as whole cents, half up, or null when it is not a non-negative amount.
 * - **Text:** "$1,234.50", "1234.5", "1.234,50" or "12,5". With both separators the last one is the decimal; a comma
 *   alone is decimal when 1 or 2 digits follow it, and a dot alone is a thousands separator only between groups of
 *   three ("1.234.567").
 * - **Number** (Excel): rounded to cents at the sixth decimal first, so 1.005 is 101 and not 100.
 */
export function parseCents(value: Cell): number | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return null;
    return roundHalfUp(Number((value * 100).toFixed(6)));
  }
  if (value === null) return null;
  let s = value.replace(/[\s\u00a0$]|MXN|M\.N\./gi, '');
  if (s === '' || s.startsWith('-') || s.startsWith('(')) return null;
  const comma = s.lastIndexOf(',');
  const dot = s.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) {
    s = comma > dot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (comma >= 0) {
    s = /^\d+,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
  } else if (/^\d{1,3}(\.\d{3}){2,}$/.test(s)) {
    s = s.replace(/\./g, '');
  }
  const m = /^(\d+)(?:\.(\d*))?$/.exec(s);
  if (!m) return null;
  const fraction = (m[2] ?? '').padEnd(3, '0');
  return Number(m[1]) * 100 + Number(fraction.slice(0, 2)) + (Number(fraction[2]) >= 5 ? 1 : 0);
}

/** A positive quantity ("1", "0.845", "0,845"), or null. */
export function parseQuantity(value: Cell): number | null {
  const n =
    typeof value === 'number'
      ? value
      : value === null || !/^\s*\d+([.,]\d+)?\s*$/.test(value)
        ? NaN
        : Number(value.trim().replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

const MONTHS: Record<string, number> = {
  ene: 1,
  feb: 2,
  mar: 3,
  abr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  ago: 8,
  sep: 9,
  set: 9,
  oct: 10,
  nov: 11,
  dic: 12,
};

export interface ImportDate {
  /** When, in epoch ms: the time read, or noon in Mexico City for a date alone, so no zone moves its day. */
  at: number;
  /** The Mexico City day, `YYYY-MM-DD`, that groups lines into one purchase. */
  day: string;
}

function dateOf(y: number, mo: number, d: number, h?: number, mi?: number, s?: number): ImportDate | null {
  const year = y < 100 ? 2000 + y : y;
  const check = new Date(Date.UTC(year, mo - 1, d));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d)
    return null;
  if (year < 2000 || year > 2100 || (h ?? 0) > 23 || (mi ?? 0) > 59 || (s ?? 0) > 59) return null;
  const day = `${year}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return { at: h === undefined ? mexicoCityMs(year, mo, d, 12) : mexicoCityMs(year, mo, d, h, mi, s), day };
}

/**
 * A purchase date, read as Mexico City time, or null.
 * - **Text:** `2026-11-04`, `04/11/2026`, `4-11-26`, `04.11.2026` (day first, as in Mexico) or `04/nov/2026`, each
 *   with an optional `13:05[:30]` and `a. m.`/`p. m.`.
 * - **Number** (Excel): days since 1899-12-30, the fraction being the time.
 */
export function parseImportDate(value: Cell): ImportDate | null {
  if (typeof value === 'number') {
    if (!(value > 20_000 && value < 80_000)) return null;
    const days = Math.floor(value);
    const seconds = Math.round((value - days) * 86_400);
    const date = new Date(Date.UTC(1899, 11, 30) + days * 86_400_000);
    const [y, mo, d] = [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()];
    if (seconds === 0) return dateOf(y, mo, d);
    return dateOf(y, mo, d, Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60);
  }
  if (value === null) return null;
  const text = foldAccents(value).trim().toLowerCase();
  const time = String.raw`(?:[ t,]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(a\.?\s?m\.?|p\.?\s?m\.?)?)?\s*$`;
  const iso = new RegExp(String.raw`^(\d{4})-(\d{1,2})-(\d{1,2})` + time).exec(text);
  const local = new RegExp(String.raw`^(\d{1,2})[/.-](\d{1,2}|[a-z]{3,})\.?[/.-](\d{4}|\d{2})` + time).exec(
    text,
  );
  const m = iso ?? local;
  if (!m) return null;
  const month = /^\d+$/.test(m[2]!) ? Number(m[2]) : MONTHS[m[2]!.slice(0, 3)];
  if (month === undefined) return null;
  const [y, d] = iso ? [Number(m[1]), Number(m[3])] : [Number(m[3]), Number(m[1])];
  if (m[4] === undefined) return dateOf(y, month, d);
  let hour = Number(m[4]);
  const half = m[7]?.[0];
  if (half && (hour < 1 || hour > 12)) return null;
  if (half === 'p' && hour < 12) hour += 12;
  if (half === 'a' && hour === 12) hour = 0;
  return dateOf(y, month, d, hour, Number(m[5]), Number(m[6] ?? 0));
}

const HEADER_WORDS: ReadonlyArray<[ImportField, RegExp]> = [
  ['ticket', /\b(folio|ticket|pedido|orden|referencia|no\.? de compra)\b/],
  ['date', /\b(fecha|date|dia)\b/],
  ['store', /\b(tienda|comercio|establecimiento|store|sucursal)\b/],
  ['quantity', /\b(cantidad|cant|piezas|qty|unidades)\b/],
  ['amount', /\b(importe|total|monto|cargo)\b/],
  ['unit_price', /\b(precio|unitario|costo|p\.? ?u\.?)\b/],
  ['description', /\b(descripcion|producto|articulo|concepto|detalle|nombre|item)\b/],
];

/** The mapping a header row suggests: each field takes the first column whose name says it, once. */
export function guessMapping(headers: readonly Cell[]): Mapping {
  const mapping: Mapping = {};
  headers.forEach((header, column) => {
    const name = foldAccents(String(header ?? '')).toLowerCase();
    const found = HEADER_WORDS.find(([field, words]) => mapping[field] === undefined && words.test(name));
    if (found) mapping[found[0]] = column;
  });
  return mapping;
}

/** Why a row was left out. */
export type SkipReason = 'NO_DATE' | 'NO_DESCRIPTION' | 'NO_PRICE' | 'BAD_QUANTITY' | 'TOO_MANY_LINES';

export interface TableLine {
  /** The row in the file, from 1. */
  row: number;
  description: string;
  quantity: number;
  unit_price_cents: number;
  final_cents: number;
}

export interface TablePurchase {
  /** The store as the file wrote it (trimmed), or null without a store column. */
  store: string | null;
  ticket: string | null;
  purchased_at: number;
  day: string;
  lines: TableLine[];
  total_cents: number;
}

export interface TableImport {
  purchases: TablePurchase[];
  skipped: Array<{ row: number; reason: SkipReason }>;
}

const text = (value: Cell) => (value === null ? '' : String(value).trim());

/**
 * The file's rows as purchases. Needs the date, the description and a unit price or an amount.
 * - **A line:** quantity 1 without its column or with its cell empty. With an amount, that is what the line cost and its unit price is
 *   the amount over the quantity; with a unit price alone, the line costs price × quantity (half up).
 * - **A purchase:** the lines of one store and one folio or, without a folio, of one store and one Mexico City day,
 *   on the earliest time read. Over 300 lines, its rows are left out.
 * - [firstRow] is the file row of `rows[0]`, for messages.
 */
export function tablePurchases(rows: readonly Cell[][], mapping: Mapping, firstRow = 1): TableImport {
  const groups = new Map<string, TablePurchase>();
  const skipped: TableImport['skipped'] = [];
  const cell = (r: readonly Cell[], field: ImportField) =>
    mapping[field] === undefined ? null : (r[mapping[field]] ?? null);
  rows.forEach((r, i) => {
    const row = firstRow + i;
    const skip = (reason: SkipReason) => void skipped.push({ row, reason });
    const date = parseImportDate(cell(r, 'date'));
    if (!date) return skip('NO_DATE');
    const description = text(cell(r, 'description')).replace(/\s+/g, ' ').slice(0, 300);
    if (!description) return skip('NO_DESCRIPTION');
    const quantityCell = cell(r, 'quantity');
    const quantity = text(quantityCell) === '' ? 1 : parseQuantity(quantityCell);
    if (quantity === null) return skip('BAD_QUANTITY');
    const amount = parseCents(cell(r, 'amount'));
    const price = parseCents(cell(r, 'unit_price'));
    let line: TableLine;
    if (amount !== null) {
      line = {
        row,
        description,
        quantity,
        unit_price_cents: roundHalfUp(amount / quantity),
        final_cents: amount,
      };
    } else if (price !== null) {
      line = {
        row,
        description,
        quantity,
        unit_price_cents: price,
        final_cents: grossCents(quantity, price),
      };
    } else return skip('NO_PRICE');

    const store = text(cell(r, 'store')) || null;
    const ticket = text(cell(r, 'ticket')).slice(0, 100) || null;
    const key = JSON.stringify(ticket ? [store, 't', ticket] : [store, 'd', date.day]);
    const group = groups.get(key);
    if (!group) {
      groups.set(key, { store, ticket, purchased_at: date.at, day: date.day, lines: [line], total_cents: 0 });
      return;
    }
    group.lines.push(line);
    if (date.at < group.purchased_at) Object.assign(group, { purchased_at: date.at, day: date.day });
  });

  const purchases: TablePurchase[] = [];
  for (const group of groups.values()) {
    if (group.lines.length > IMPORT_MAX_LINES) {
      for (const l of group.lines) skipped.push({ row: l.row, reason: 'TOO_MANY_LINES' });
      continue;
    }
    group.total_cents = group.lines.reduce((sum, l) => sum + l.final_cents, 0);
    purchases.push(group);
  }
  purchases.sort((a, b) => a.purchased_at - b.purchased_at || (a.store ?? '').localeCompare(b.store ?? ''));
  skipped.sort((a, b) => a.row - b.row);
  return { purchases, skipped };
}
