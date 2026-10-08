/** Removes diacritics: NFKD decomposition without combining marks ("Ñoquis" → "Noquis"). */
export function foldAccents(s: string): string {
  return s.normalize('NFKD').replace(/\p{M}+/gu, '');
}
