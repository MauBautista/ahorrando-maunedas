import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { syntheticEmail } from '../src/auth/username';
import { loadFixture } from './fixtures';

const fixture = loadFixture(
  'usuarios.json',
  z.strictObject({
    descripcion: z.string(),
    dominio: z.string(),
    casos: z.array(z.strictObject({ entrada: z.string(), esperado: z.string() })),
  }),
);

describe('usuarios.json', () => {
  it.each(fixture.casos)('"$entrada"', (c) => {
    if (c.esperado === 'error') {
      expect(() => syntheticEmail(c.entrada, fixture.dominio)).toThrow('USERNAME_INVALID');
    } else {
      expect(syntheticEmail(c.entrada, fixture.dominio)).toBe(c.esperado);
    }
  });
});
