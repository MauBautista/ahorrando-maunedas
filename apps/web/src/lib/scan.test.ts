import { describe, expect, it } from 'vitest';
import { ScanGate, scanCode } from './scan';

/** Android's `ScanCodes` and `ScanGate` (T-122, decision T64). */
describe('camera reads', () => {
  it('keeps product codes as digits only', () => {
    expect(scanCode('750-1020 515343')).toBe('7501020515343');
    expect(scanCode('12345')).toBeNull();
    expect(scanCode('https://x.mx')).toBeNull();
  });

  it('reports a code read twice within a second, once, and another code as soon as it is confirmed', () => {
    const gate = new ScanGate();
    expect(gate.accept('111', 0)).toBe(false);
    // A misread of one frame never counts.
    expect(gate.accept('999', 100)).toBe(false);
    expect(gate.accept('111', 200)).toBe(true);
    // Read again at once (the label is still there): not reported twice.
    expect(gate.accept('111', 300)).toBe(false);
    expect(gate.accept('111', 400)).toBe(false);
    // Still in view: quiet, and each read keeps it quiet.
    expect(gate.accept('111', 1_500)).toBe(false);
    expect(gate.accept('111', 3_400)).toBe(false);
    expect(gate.accept('222', 3_500)).toBe(false);
    expect(gate.accept('222', 3_600)).toBe(true);
    // Two reads more than a second apart are not a confirmation.
    const slow = new ScanGate();
    expect(slow.accept('333', 0)).toBe(false);
    expect(slow.accept('333', 1_001)).toBe(false);
    expect(slow.accept('333', 1_500)).toBe(true);
  });
});
