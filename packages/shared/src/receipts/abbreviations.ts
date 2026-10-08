/** Common receipt abbreviations (SDD 09 §5.3). Keys and values are normalized receipt text. */
export const RECEIPT_ABBREVIATIONS: Readonly<Record<string, string>> = {
  LCH: 'LECHE',
  ENT: 'ENTERA',
  DESC: 'DESCREMADA',
  DET: 'DETERGENTE',
  JAB: 'JABON',
  PAP: 'PAPEL',
  HIG: 'HIGIENICO',
  ACON: 'ACONDICIONADOR',
  REF: 'REFRESCO',
  GALL: 'GALLETAS',
  YOG: 'YOGURT',
  QSO: 'QUESO',
  JAM: 'JAMON',
  PECH: 'PECHUGA',
  ACEIT: 'ACEITE',
  AZUC: 'AZUCAR',
  SUAV: 'SUAVIZANTE',
  DESOD: 'DESODORANTE',
};

/**
 * Expands whole-word abbreviations in normalized receipt text: "LCH LALA ENT 1L" → "LECHE LALA ENTERA 1L".
 * "DESC" followed by a number or % is a discount ("DESC 15%"), not "descremada", and is kept.
 */
export function expandAbbreviations(norm: string): string {
  const tokens = norm.split(' ').filter((token) => token !== '');
  return tokens
    .map((token, i) => {
      if (token === 'DESC' && /^[\d%]/.test(tokens[i + 1] ?? '')) return token;
      return RECEIPT_ABBREVIATIONS[token] ?? token;
    })
    .join(' ');
}
