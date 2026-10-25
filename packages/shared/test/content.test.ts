import { describe, expect, it } from 'vitest';
import { contentUnitsOf, forEditing, toBase } from '../src/catalog/content';

/** The cases of Kotlin `Content` (core:pricing): both editors save the same base amount. */
describe('content (S-10)', () => {
  it('turns typed content into base units without float noise', () => {
    expect([
      toBase(1.1, 'kg'),
      toBase(946, 'ml'),
      toBase(1.5, 'L'),
      toBase(30, 'pz'),
      toBase(0.3333, 'kg'),
    ]).toEqual([1100, 946, 1500, 30, 333.3]);
  });

  it('shows a saved amount in kg or L from 1000 up', () => {
    expect(forEditing('mass', 1100)).toEqual({ unit: 'kg', amount: 1.1 });
    expect(forEditing('mass', 500)).toEqual({ unit: 'g', amount: 500 });
    expect(forEditing('volume', 1000)).toEqual({ unit: 'L', amount: 1 });
    expect(forEditing('count', 12)).toEqual({ unit: 'pz', amount: 12 });
    expect(contentUnitsOf('volume')).toEqual(['ml', 'L']);
  });
});
