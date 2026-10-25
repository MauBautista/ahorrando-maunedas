import { describe, expect, it } from 'vitest';
import { ago, formatDate, formatMoney, formatUnitPrice } from './format';

describe('format', () => {
  it('writes money in pesos and per unit', () => {
    expect(formatMoney(123_450)).toBe('$1,234.50');
    expect(formatMoney(5)).toBe('$0.05');
    expect(formatUnitPrice(2_650, 'L')).toBe('$26.50/L');
    expect(formatUnitPrice(1_190, '100g')).toBe('$11.90/100 g');
  });

  it('counts age in calendar days of Mexico City, as Android', () => {
    // 2026-10-24 23:30 and 2026-10-25 00:30 in Mexico City are a day apart, though an hour.
    const late = Date.UTC(2026, 9, 25, 5, 30);
    expect(ago(late, Date.UTC(2026, 9, 25, 6, 30))).toBe('ayer');
    expect(ago(Date.UTC(2026, 9, 25, 7), Date.UTC(2026, 9, 25, 20))).toBe('hoy');
    const now = Date.UTC(2026, 9, 25, 18);
    const daysBefore = (n: number) => now - n * 86_400_000;
    expect([2, 13, 14, 59, 60, 95].map((n) => ago(daysBefore(n), now))).toEqual([
      'hace 2 días',
      'hace 13 días',
      'hace 2 semanas',
      'hace 8 semanas',
      'hace 2 meses',
      'hace 3 meses',
    ]);
    expect(formatDate(Date.UTC(2026, 9, 12, 18))).toBe('12 oct 2026');
  });
});
