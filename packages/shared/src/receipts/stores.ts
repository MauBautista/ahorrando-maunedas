import { foldAccents } from '../text/fold';

/** Printed names that map to a store (SDD 09 §5.4). `canonical` matches `stores.name` of the seeds. */
export const STORE_SYNONYMS: ReadonlyArray<{ canonical: string; aliases: readonly string[] }> = [
  { canonical: 'Walmart', aliases: ['WAL MART', 'WALMART SUPERCENTER', 'WALMART EXPRESS'] },
  { canonical: 'Bodega Aurrera', aliases: ['AURRERA', 'MI BODEGA'] },
  { canonical: "Sam's Club", aliases: ['SAMS', 'SAM S CLUB'] },
  { canonical: 'Farmacias Similares', aliases: ['SIMILARES'] },
  { canonical: 'Farmacias Guadalajara', aliases: ['FARMACIA GUADALAJARA'] },
  { canonical: 'Costco', aliases: ['COSTCO WHOLESALE'] },
];

/** Legal names printed on receipts of several chains of the same group; never used to guess the store. */
export const IGNORED_LEGAL_NAMES: readonly string[] = ['NUEVA WAL MART DE MEXICO'];

const norm = (s: string) =>
  foldAccents(s)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();

const containsWords = (haystack: string, needle: string) =>
  needle !== '' && ` ${haystack} `.includes(` ${needle} `);

/**
 * Guesses the store from the printed name: the longest store name or synonym contained in it, as whole
 * words, wins. Returns the store id or null.
 */
export function matchStoreName(
  printed: string | null,
  stores: ReadonlyArray<{ id: string; name: string }>,
): string | null {
  if (!printed) return null;
  let text = norm(printed);
  for (const legal of IGNORED_LEGAL_NAMES) text = ` ${text} `.replace(` ${norm(legal)} `, ' ').trim();
  if (text === '') return null;

  const byName = new Map(stores.map((s) => [norm(s.name), s.id]));
  const candidates: Array<{ phrase: string; storeId: string }> = [...byName].map(([phrase, storeId]) => ({
    phrase,
    storeId,
  }));
  for (const group of STORE_SYNONYMS) {
    const storeId = byName.get(norm(group.canonical));
    if (storeId) for (const alias of group.aliases) candidates.push({ phrase: norm(alias), storeId });
  }

  let best: { phrase: string; storeId: string } | null = null;
  for (const c of candidates) {
    if (containsWords(text, c.phrase) && (!best || c.phrase.length > best.phrase.length)) best = c;
  }
  return best?.storeId ?? null;
}
