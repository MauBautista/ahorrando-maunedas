import { describe, expect, it } from 'vitest';
import { parseAmount, parseCents, plainCents } from '../src/text/decimal';

/** The cases of Android's MoneyTest (core:model), so both apps read a typed price the same way. */
describe('typed money and amounts (05 §7)', () => {
  it('parses prices with either decimal separator', () => {
    const cases: Record<string, number> = {
      '28.5': 2850,
      '28,5': 2850,
      '28.50': 2850,
      '$ 12': 1200,
      '0.05': 5,
      ',5': 50,
      '1,234.50': 123450,
      '1.234,50': 123450,
      '1,234,567.89': 123456789,
      '1,234,567': 123456700,
      '  159 ': 15900,
    };
    for (const [input, cents] of Object.entries(cases)) expect(parseCents(input), input).toBe(cents);
  });

  it('rejects what is not a price', () => {
    for (const input of ['', ' ', 'abc', '12.345', '-5', '1.2.3,4.5a', '12,3x', '$', '1e3'])
      expect(parseCents(input), input).toBeNull();
  });

  it('writes the plain text of a price', () => {
    expect([plainCents(2850), plainCents(5), plainCents(0), plainCents(123456789)]).toEqual([
      '28.50',
      '0.05',
      '0.00',
      '1234567.89',
    ]);
  });

  it('parses positive amounts with up to three decimals', () => {
    expect([parseAmount('0.845'), parseAmount('1,5'), parseAmount('2')]).toEqual([0.845, 1.5, 2]);
    for (const input of ['0', '0,000', '1.2345', '-1', 'x']) expect(parseAmount(input), input).toBeNull();
  });
});
