import { describe, expect, it } from 'vitest';
import { signPath, verifySigned } from '../src/images/signing';

const SECRET = 'test-secret';
const PATH = '/v1/images/0192a5e0-7c3e-7b2a-9f1d-3c4b5a6d7e8f/blobs/original.jpg';
const T0 = 1_792_389_600_000;
const parse = (signed: string) => Object.fromEntries(new URL(signed, 'https://x').searchParams);

describe('signed URLs (10 §3)', () => {
  it('a valid signature verifies until it expires', async () => {
    const { exp, sig } = parse(await signPath(SECRET, PATH, 24 * 3_600_000, T0));
    expect(await verifySigned(SECRET, PATH, exp, sig, T0 + 3_600_000)).toBe(true);
    expect(await verifySigned(SECRET, PATH, exp, sig, Number(exp) + 1)).toBe(false);
  });

  it('a tampered signature, another path or another secret fail', async () => {
    const { exp, sig } = parse(await signPath(SECRET, PATH, 24 * 3_600_000, T0));
    const flipped = `${sig!.slice(0, -1)}${sig!.endsWith('0') ? '1' : '0'}`;
    expect(await verifySigned(SECRET, PATH, exp, flipped, T0)).toBe(false);
    expect(await verifySigned(SECRET, PATH.replace('original.jpg', 'x.webp'), exp, sig, T0)).toBe(false);
    expect(await verifySigned('other-secret', PATH, exp, sig, T0)).toBe(false);
    expect(await verifySigned(SECRET, PATH, String(Number(exp) + 1), sig, T0)).toBe(false);
    expect(await verifySigned(SECRET, PATH, undefined, sig, T0)).toBe(false);
  });

  it('24 h URLs round expiry up to 6 h windows (stable, cacheable)', async () => {
    const a = parse(await signPath(SECRET, PATH, 24 * 3_600_000, T0 + 1));
    const b = parse(await signPath(SECRET, PATH, 24 * 3_600_000, T0 + 3_600_000));
    expect(a.exp).toBe(b.exp);
    expect(Number(a.exp) % (6 * 3_600_000)).toBe(0);
  });

  it('10-minute URLs expire exactly after 10 minutes (no 6 h window)', async () => {
    const { exp, sig } = parse(await signPath(SECRET, PATH, 10 * 60_000, T0));
    expect(Number(exp)).toBe(T0 + 10 * 60_000);
    expect(await verifySigned(SECRET, PATH, exp, sig, T0 + 11 * 60_000)).toBe(false);
  });
});
