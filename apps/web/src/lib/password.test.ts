import { describe, expect, it } from 'vitest';
import { generatePassword } from './password';

describe('generated passwords (W-11)', () => {
  it('are 12 unambiguous letters and digits, different each time', () => {
    const a = generatePassword();
    expect(a).toMatch(/^[a-km-np-zA-HJ-NP-Z2-9]{12}$/);
    expect(generatePassword(20)).toHaveLength(20);
    expect(new Set(Array.from({ length: 20 }, () => generatePassword())).size).toBe(20);
  });
});
