import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { listFixtures } from './fixtures';

/** Every shared fixture must have a suite here; a new fixture cannot be left untested. */
const SUITES: Record<string, string> = {
  'cantidades.json': 'quantity.fixtures.test.ts',
  'ids.json': 'uuid.fixtures.test.ts',
  'normalizacion.json': 'units.fixtures.test.ts',
  'promociones.json': 'promotions.fixtures.test.ts',
  'textos.json': 'text.fixtures.test.ts',
  'usuarios.json': 'username.fixtures.test.ts',
};

describe('fixtures coverage', () => {
  it('has a suite for every file in fixtures/', () => {
    expect(listFixtures()).toEqual(Object.keys(SUITES).sort());
  });

  it.each(Object.entries(SUITES))('%s → %s exists', (_fixture, suite) => {
    expect(existsSync(new URL(suite, import.meta.url))).toBe(true);
  });
});
