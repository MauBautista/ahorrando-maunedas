import { describe, expect, it } from 'vitest';
import {
  guessMapping,
  parseCents,
  parseCsv,
  parseImportDate,
  parseQuantity,
  tablePurchases,
  type Cell,
} from '../src/imports/table';
import { mexicoCityMs } from '../src/util/time';

/** Noon of a Mexico City day, UTC−6 since 2022. */
const noon = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d, 18);

describe('Mexico City time (rule 2)', () => {
  it('turns a local clock into UTC, with the summer time the city kept until 2022', () => {
    expect(mexicoCityMs(2026, 12, 31, 23, 59, 59)).toBe(Date.UTC(2027, 0, 1, 5, 59, 59));
    expect(mexicoCityMs(2026, 11, 4)).toBe(Date.UTC(2026, 10, 4, 6));
    // July 2021 was UTC−5.
    expect(mexicoCityMs(2021, 7, 1, 12)).toBe(Date.UTC(2021, 6, 1, 17));
  });
});

describe('CSV (RFC 4180)', () => {
  it('reads quoted cells, doubled quotes, line breaks inside quotes and any line ending', () => {
    const csv =
      '\uFEFFFecha,Descripción,Importe\r\n04/11/2026,"Leche ""Lala"", 1 L","$1,234.50"\n\n05/11/2026,"Pan\nblanco",20\r';
    expect(parseCsv(csv)).toEqual([
      ['Fecha', 'Descripción', 'Importe'],
      ['04/11/2026', 'Leche "Lala", 1 L', '$1,234.50'],
      ['05/11/2026', 'Pan\nblanco', '20'],
    ]);
  });

  it('finds the delimiter in the first line', () => {
    expect(parseCsv('a;b;"c;d"\n1;2,5;3')).toEqual([
      ['a', 'b', 'c;d'],
      ['1', '2,5', '3'],
    ]);
    expect(parseCsv('a\tb\n1\t2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    // A comma inside quotes does not count.
    expect(parseCsv('"x,y,z";b\n1;2')).toEqual([
      ['x,y,z', 'b'],
      ['1', '2'],
    ]);
    expect(parseCsv('solo')).toEqual([['solo']]);
    expect(parseCsv(' , \n')).toEqual([]);
  });
});

describe('cells', () => {
  it('reads money as cents from its text, never through a float', () => {
    const cases: Array<[Cell, number | null]> = [
      ['$1,234.50', 123_450],
      ['1234.5', 123_450],
      ['1.234,50', 123_450],
      ['12,5', 1_250],
      ['1,234', 123_400],
      ['1.234', 123],
      ['1.234.567', 123_456_700],
      ['0.005', 1],
      ['0.0049', 0],
      ['  25 MXN ', 2_500],
      ['$ 25 M.N.', 2_500],
      ['7', 700],
      ['-5', null],
      ['(5.00)', null],
      ['abc', null],
      ['1e3', null],
      ['', null],
      [null, null],
      [2.675, 268],
      // 1.005 × 100 is 100.49999999999999 in floats.
      [1.005, 101],
      [19.9, 1_990],
      [-1, null],
      [Number.NaN, null],
    ];
    for (const [value, cents] of cases) expect([value, parseCents(value)]).toEqual([value, cents]);
  });

  it('reads quantities', () => {
    expect([parseQuantity('2'), parseQuantity('0,845'), parseQuantity(' 1.5 '), parseQuantity(3)]).toEqual([
      2, 0.845, 1.5, 3,
    ]);
    for (const bad of ['0', '-1', 'dos', '', null, 0, '1/2'])
      expect([bad, parseQuantity(bad)]).toEqual([bad, null]);
  });

  it('reads dates day first, as Mexico City time, and a date alone at noon', () => {
    const at = (value: Cell) => parseImportDate(value)?.at ?? null;
    expect(parseImportDate('04/11/2026')).toEqual({ at: noon(2026, 11, 4), day: '2026-11-04' });
    expect(at('2026-11-04')).toBe(noon(2026, 11, 4));
    expect(at('4-11-26')).toBe(noon(2026, 11, 4));
    expect(at('04.11.2026')).toBe(noon(2026, 11, 4));
    expect(at('04/Nov/2026')).toBe(noon(2026, 11, 4));
    expect(at('4 dic 2026')).toBeNull();
    expect(at('04-dic.-2026')).toBe(noon(2026, 12, 4));
    expect(at('04/septiembre/2026')).toBe(noon(2026, 9, 4));
    expect(at('2026-11-04 13:05')).toBe(Date.UTC(2026, 10, 4, 19, 5));
    expect(at('2026-11-04T13:05:30')).toBe(Date.UTC(2026, 10, 4, 19, 5, 30));
    expect(at('04/11/2026, 1:05 p. m.')).toBe(Date.UTC(2026, 10, 4, 19, 5));
    expect(at('04/11/2026 12:10 a.m.')).toBe(Date.UTC(2026, 10, 4, 6, 10));
    expect(at('04/11/2026 12:10 pm')).toBe(Date.UTC(2026, 10, 4, 18, 10));
    // The day is Mexico City's even late at night.
    expect(parseImportDate('04/11/2026 23:30')!.day).toBe('2026-11-04');
    for (const bad of [
      '31/02/2026',
      '13/13/2026',
      '2026-11-04 25:00',
      '04/11/2026 13:00 pm',
      '04/11/1999',
      'ayer',
      '',
      null,
      'x/11/2026',
    ]) {
      expect([bad, at(bad)]).toEqual([bad, null]);
    }
  });

  it('reads Excel dates as serial days', () => {
    // 46330 is 2026-11-04; .5 is noon and .75 is 18:00.
    expect(parseImportDate(46330)).toEqual({ at: noon(2026, 11, 4), day: '2026-11-04' });
    expect(parseImportDate(46330.75)!.at).toBe(Date.UTC(2026, 10, 5, 0));
    expect(parseImportDate(46330.5)!.at).toBe(noon(2026, 11, 4));
    expect([parseImportDate(5), parseImportDate(90_000), parseImportDate(30_000)]).toEqual([
      null,
      null,
      null,
    ]);
  });
});

describe('mapping', () => {
  it('guesses each field from the header once', () => {
    expect(
      guessMapping([
        'Fecha',
        'Tienda',
        'Artículo',
        'Cant.',
        'Precio unitario',
        'Importe total',
        'Folio',
        'Fecha 2',
      ]),
    ).toEqual({ date: 0, store: 1, description: 2, quantity: 3, unit_price: 4, amount: 5, ticket: 6 });
    expect(guessMapping(['Día de compra', 'Concepto', 'Monto', null, 42])).toEqual({
      date: 0,
      description: 1,
      amount: 2,
    });
    expect(guessMapping(['a', 'b'])).toEqual({});
  });
});

describe('rows to purchases (T-306)', () => {
  const rows: Cell[][] = [
    ['04/11/2026', 'Walmart', 'Leche Lala 1 L', '2', '28.50', ''],
    ['04/11/2026 18:00', ' Walmart ', 'Pan  blanco', '', '', '45'],
    ['04/11/2026', 'Soriana', 'Huevo', '1', '60', ''],
    ['05/11/2026', 'Walmart', 'Café', '0,5', '', '$100.00'],
    ['sin fecha', 'Walmart', 'Algo', '1', '1', ''],
    ['05/11/2026', 'Walmart', '  ', '1', '1', ''],
    ['05/11/2026', 'Walmart', 'Sin precio', '1', 'gratis', ''],
    ['05/11/2026', 'Walmart', 'Mala cantidad', 'dos', '1', ''],
  ];
  const mapping = { date: 0, store: 1, description: 2, quantity: 3, unit_price: 4, amount: 5 };

  it('groups a store and a day into one purchase, with each line as paid', () => {
    const { purchases, skipped } = tablePurchases(rows, mapping, 2);
    expect(
      purchases.map((p) => [p.store, p.day, p.purchased_at, p.total_cents, p.lines.map((l) => l.row)]),
    ).toEqual([
      ['Soriana', '2026-11-04', noon(2026, 11, 4), 6_000, [4]],
      ['Walmart', '2026-11-04', noon(2026, 11, 4), 10_200, [2, 3]],
      ['Walmart', '2026-11-05', noon(2026, 11, 5), 10_000, [5]],
    ]);
    expect(purchases[1]!.lines).toEqual([
      { row: 2, description: 'Leche Lala 1 L', quantity: 2, unit_price_cents: 2_850, final_cents: 5_700 },
      // An empty quantity is one.
      { row: 3, description: 'Pan blanco', quantity: 1, unit_price_cents: 4_500, final_cents: 4_500 },
    ]);
    // With an amount, the unit price is the amount over the quantity.
    expect(purchases[2]!.lines[0]).toMatchObject({
      quantity: 0.5,
      unit_price_cents: 20_000,
      final_cents: 10_000,
    });
    expect(skipped).toEqual([
      { row: 6, reason: 'NO_DATE' },
      { row: 7, reason: 'NO_DESCRIPTION' },
      { row: 8, reason: 'NO_PRICE' },
      { row: 9, reason: 'BAD_QUANTITY' },
    ]);
  });

  it('with a price and an amount, the amount is what the line cost', () => {
    const { purchases } = tablePurchases([['04/11/2026', 'Uva', '2', '30', '$50']], {
      date: 0,
      description: 1,
      quantity: 2,
      unit_price: 3,
      amount: 4,
    });
    expect(purchases[0]!.lines[0]).toMatchObject({
      quantity: 2,
      unit_price_cents: 2_500,
      final_cents: 5_000,
    });
  });

  it('a folio makes the purchase, on its earliest time', () => {
    const { purchases } = tablePurchases(
      [
        ['05/11/2026 10:00', 'A-1', 'Uno', '10'],
        ['04/11/2026 09:00', 'A-1', 'Dos', '5'],
        ['04/11/2026 09:00', 'A-2', 'Tres', '1'],
        ['04/11/2026 09:00', '', 'Cuatro', '1'],
      ],
      { date: 0, ticket: 1, description: 2, amount: 3 },
    );
    expect(purchases.map((p) => [p.ticket, p.store, p.day, p.lines.length, p.total_cents])).toEqual([
      ['A-1', null, '2026-11-04', 2, 1_500],
      ['A-2', null, '2026-11-04', 1, 100],
      [null, null, '2026-11-04', 1, 100],
    ]);
    expect(purchases[0]!.purchased_at).toBe(Date.UTC(2026, 10, 4, 15));
  });

  it('without a quantity column every line is one, and a huge purchase is left out', () => {
    const many: Cell[][] = Array.from({ length: 301 }, (_, i) => ['04/11/2026', `Cosa ${i}`, 1]);
    const one: Cell[][] = [[46330, 'Agua', 12.5]];
    const { purchases, skipped } = tablePurchases(
      [...one, ...many.map((r) => ['05/11/2026', ...r.slice(1)])],
      {
        date: 0,
        description: 1,
        unit_price: 2,
      },
    );
    expect(purchases).toHaveLength(1);
    expect(purchases[0]!.lines[0]).toMatchObject({
      quantity: 1,
      unit_price_cents: 1_250,
      final_cents: 1_250,
    });
    expect(skipped).toHaveLength(301);
    expect(new Set(skipped.map((s) => s.reason))).toEqual(new Set(['TOO_MANY_LINES']));
    // 300 lines still make one purchase.
    expect(
      tablePurchases(many.slice(1), { date: 0, description: 1, unit_price: 2 }).purchases[0]!.lines,
    ).toHaveLength(300);
  });
});
