import { describe, expect, it } from 'vitest';
import { addDays, dateKey, dayTitle, formatTime, monthStart, timeKey, zonedEpoch } from './dates';
import { decodeParams, encodeParams, promotionText } from './promotions';

const at = (iso: string) => Date.parse(iso);

describe('Mexico City days (HouseholdTime)', () => {
  it('turns days and times of Mexico City into instants and back', () => {
    // 23:30 in Mexico City is already the next day in UTC.
    const late = zonedEpoch('2026-10-25', '23:30');
    expect(late).toBe(at('2026-10-26T05:30:00Z'));
    expect([dateKey(late), timeKey(late)]).toEqual(['2026-10-25', '23:30']);
    // Summer time until 2022: UTC−5 in July 2021.
    expect(zonedEpoch('2021-07-01')).toBe(at('2021-07-01T05:00:00Z'));
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(formatTime(late)).toBe('11:30 p.m.');
  });

  it('starts months in Mexico City', () => {
    const now = at('2026-11-01T03:00:00Z'); // still October 31 there
    expect(monthStart(now)).toBe(at('2026-10-01T06:00:00Z'));
    expect(monthStart(now, 1)).toBe(at('2026-09-01T06:00:00Z'));
    expect(monthStart(at('2026-01-15T18:00:00Z'), 2)).toBe(at('2025-11-01T06:00:00Z'));
  });

  it('heads a day as Android (Dates.dayTitle)', () => {
    const now = at('2026-10-25T18:00:00Z');
    expect(dayTitle(at('2026-10-25T07:00:00Z'), now)).toBe('Hoy');
    expect(dayTitle(at('2026-10-25T05:59:00Z'), now)).toBe('Ayer');
    expect(dayTitle(at('2026-10-20T18:00:00Z'), now)).toBe('martes 20 de octubre');
    expect(dayTitle(at('2025-10-20T18:00:00Z'), now)).toBe('20 de octubre de 2025');
  });
});

describe('promotions as they read and are saved', () => {
  it('reads as Android and falls back to the type name', () => {
    expect(promotionText('nxm', { n: 3, m: 2 })).toBe('3x2');
    expect(promotionText('percent', { percent: 15 })).toBe('15 % de descuento');
    expect(promotionText('price_cut', { from_cents: 3000, to_cents: 2500 })).toBe('Rebaja a $25.00');
    expect(promotionText('nth_unit_discount', { nth: 2 })).toBe('N-ésima con descuento');
  });

  it('keeps only the set fields, as PromoParamsJson', () => {
    expect(encodeParams({ n: 2, m: 1 })).toBe('{"n":2,"m":1}');
    expect(encodeParams({})).toBeNull();
    expect(decodeParams('{"n":2,"m":"1","code":"AB","x":3}')).toEqual({ n: 2, code: 'AB' });
    expect(decodeParams('no')).toEqual({});
  });
});
