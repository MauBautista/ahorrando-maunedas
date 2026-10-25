import { describe, expect, it } from 'vitest';
import { listItem } from '../../test/purchases';
import { periodRange } from './periods';
import { purchaseTotal } from './total';

const at = (iso: string) => Date.parse(iso);

describe('purchase list rules (S-02, S-03)', () => {
  it('counts whole months and days of Mexico City (T59)', () => {
    const now = at('2026-10-25T18:00:00Z');
    expect(periodRange('este-mes', now, '', '')).toEqual({
      from: at('2026-10-01T06:00:00Z'),
      to: at('2026-11-01T06:00:00Z') - 1,
    });
    expect(periodRange('mes-pasado', now, '', '')).toEqual({
      from: at('2026-09-01T06:00:00Z'),
      to: at('2026-10-01T06:00:00Z') - 1,
    });
    expect(periodRange('tres-meses', now, '', '')).toEqual({
      from: at('2026-08-01T06:00:00Z'),
      to: at('2026-11-01T06:00:00Z') - 1,
    });
    expect(periodRange('fechas', now, '2026-10-20', '2026-10-20')).toEqual({
      from: at('2026-10-20T06:00:00Z'),
      to: at('2026-10-21T06:00:00Z') - 1,
    });
    expect(periodRange('fechas', now, '', '2026-10-20')).toEqual({
      from: undefined,
      to: at('2026-10-21T06:00:00Z') - 1,
    });
    expect(periodRange('', now, '2026-10-20', '')).toEqual({});
  });

  it('totals the ticket, or the lines less the ticket discount, never below zero', () => {
    expect(purchaseTotal(listItem({ total_cents: 9900, lines_total_cents: 5000 }))).toBe(9900);
    expect(purchaseTotal(listItem({ lines_total_cents: 5000, discount_cents: 500 }))).toBe(4500);
    expect(purchaseTotal(listItem({ lines_total_cents: 300, discount_cents: 500 }))).toBe(0);
  });
});
