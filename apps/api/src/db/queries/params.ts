import { searchKey } from '@maunedas/shared/text/searchKey';

/** Positional parameters for a dynamically built statement: `bind(v)` returns its `?n` placeholder. */
export function sqlParams() {
  const params: unknown[] = [];
  return {
    params,
    bind(value: unknown): string {
      params.push(value);
      return `?${params.length}`;
    },
  };
}

/** Words of a search, normalized like `products.search_key`; every one must appear (AND, partial). */
export const searchWords = (q: string | undefined) =>
  q ? searchKey(q).split(' ').filter(Boolean).slice(0, 8) : [];

/** A query of 6 to 14 digits also matches an exact barcode. */
export const isBarcodeQuery = (q: string | undefined) => (q ? /^\d{6,14}$/.test(q.trim()) : false);
