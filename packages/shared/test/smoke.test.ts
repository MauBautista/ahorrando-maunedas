import { describe, expect, it } from 'vitest';
import { SHARED_RULES_VERSION } from '../src/version';

describe('shared', () => {
  it('exposes a rules version', () => {
    expect(SHARED_RULES_VERSION).toBe(1);
  });
});
