import { describe, expect, it } from 'vitest';
import { expandAbbreviations } from '../src/receipts/abbreviations';
import { matchStoreName } from '../src/receipts/stores';

const STORES = [
  { id: 'walmart', name: 'Walmart' },
  { id: 'aurrera', name: 'Bodega Aurrera' },
  { id: 'gran-bodega', name: 'Gran Bodega' },
  { id: 'sams', name: "Sam's Club" },
  { id: 'similares', name: 'Farmacias Similares' },
  { id: 'oxxo', name: 'OXXO' },
];

describe('expandAbbreviations', () => {
  it('expands whole tokens only', () => {
    expect(expandAbbreviations('LCH LALA ENT 1L')).toBe('LECHE LALA ENTERA 1L');
    expect(expandAbbreviations('LCHX ENTRADA')).toBe('LCHX ENTRADA');
  });

  it('keeps DESC when it announces a discount', () => {
    expect(expandAbbreviations('DESC 15% SHAMPOO H S')).toBe('DESC 15% SHAMPOO H S');
    expect(expandAbbreviations('LCH DESC LALA 1L')).toBe('LECHE DESCREMADA LALA 1L');
  });
});

describe('matchStoreName', () => {
  it.each([
    ['WALMART SUPERCENTER PUEBLA', 'walmart'],
    ['WAL MART', 'walmart'],
    ['Bodega Aurrera Express', 'aurrera'],
    ['MI BODEGA', 'aurrera'],
    ['GRAN BODEGA', 'gran-bodega'],
    ["SAM'S CLUB", 'sams'],
    ['SAMS', 'sams'],
    ['Similares', 'similares'],
    ['oxxo', 'oxxo'],
  ])('"%s" → %s', (printed, expected) => {
    expect(matchStoreName(printed, STORES)).toBe(expected);
  });

  it('ignores the legal name shared by several chains', () => {
    expect(matchStoreName('NUEVA WAL MART DE MEXICO S DE RL DE CV', STORES)).toBeNull();
    expect(matchStoreName('NUEVA WAL MART DE MEXICO BODEGA AURRERA', STORES)).toBe('aurrera');
  });

  it('returns null when nothing matches', () => {
    expect(matchStoreName('TIENDA DESCONOCIDA', STORES)).toBeNull();
    expect(matchStoreName(null, STORES)).toBeNull();
  });
});
