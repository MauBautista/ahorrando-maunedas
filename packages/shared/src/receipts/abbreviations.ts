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

/** Expands whole-word abbreviations in normalized receipt text: "LCH LALA ENT 1L" → "LECHE LALA ENTERA 1L". */
export function expandAbbreviations(norm: string): string {
  return norm
    .split(' ')
    .filter((token) => token !== '')
    .map((token) => RECEIPT_ABBREVIATIONS[token] ?? token)
    .join(' ');
}
