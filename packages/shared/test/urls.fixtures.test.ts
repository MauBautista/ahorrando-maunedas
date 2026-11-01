import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { canonicalListing, firstUrl, isShortLink } from '../src/tracking/urls';
import { loadFixture } from './fixtures';

const Fixture = z.object({
  descripcion: z.string(),
  canonica: z.array(
    z.object({
      entrada: z.string(),
      esperado: z
        .object({ adapter: z.string(), canonical_url: z.string(), external_id: z.string().nullable() })
        .nullable(),
    }),
  ),
});

const fixture = loadFixture('enlaces.json', Fixture);

describe('fixtures/enlaces.json (07 §9)', () => {
  it.each(fixture.canonica)('$entrada', ({ entrada, esperado }) => {
    expect(canonicalListing(entrada)).toEqual(esperado);
  });
});

describe('shared links', () => {
  it('takes the first URL out of a shared text, without trailing punctuation', () => {
    expect(firstUrl('Mira esto https://amzn.to/3xYz, está barato!')).toBe('https://amzn.to/3xYz');
    expect(firstUrl('(https://www.costco.com.mx/p/123456).')).toBe('https://www.costco.com.mx/p/123456');
    expect(firstUrl('sin enlace')).toBeNull();
  });

  it('knows short links', () => {
    expect(isShortLink('https://amzn.to/3xYz')).toBe(true);
    expect(isShortLink('https://a.co/d/abc')).toBe(true);
    expect(isShortLink('https://www.amazon.com.mx/dp/B07XJ8C8F5')).toBe(false);
  });
});
