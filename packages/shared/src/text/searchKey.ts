import { foldAccents } from './fold';

/**
 * Catalog search key (`products.search_key`): no accents, lowercase, every run of characters other than
 * a-z and 0-9 becomes one space, trimmed. "Café Legal 1.5 kg" → "cafe legal 1 5 kg".
 */
export function searchKey(input: string): string {
  return foldAccents(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
