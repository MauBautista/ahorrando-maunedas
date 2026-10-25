// Barcode reads of the camera (05 §5 S-11), Kotlin `ScanCodes` and `ScanGate` in core:camera.

const SEPARATORS = /[\s-]/g;
const VALID = /^[0-9]{6,14}$/;

/** A read as `barcodes.code` (03 §8): digits only, 6 to 14 of them; null for anything else (a URL, letters…). */
export function scanCode(raw: string): string | null {
  const code = raw.replace(SEPARATORS, '');
  return VALID.test(code) ? code : null;
}

/**
 * Which reads count.
 * - **Confirmed:** a code counts once it was read [confirmations] times within [windowMs]. A blurry frame can decode
 *   a wrong code that even passes the check digit, but only once, while a real label is read again at once (T64).
 * - **Quiet:** the code reported stays quiet while it is still read within [quietMs] of the last time.
 */
export class ScanGate {
  private lastCode: string | null = null;
  private lastAt = -Infinity;
  private recent: Array<{ code: string; at: number }> = [];

  constructor(
    private readonly quietMs = 2_000,
    private readonly confirmations = 2,
    private readonly windowMs = 1_000,
  ) {}

  /** True when this read should be reported. */
  accept(code: string, now: number): boolean {
    if (code === this.lastCode && now - this.lastAt < this.quietMs) {
      this.lastAt = now;
      return false;
    }
    this.recent = this.recent.filter((r) => now - r.at <= this.windowMs);
    this.recent.push({ code, at: now });
    if (this.recent.filter((r) => r.code === code).length < this.confirmations) return false;
    this.recent = this.recent.filter((r) => r.code !== code);
    this.lastCode = code;
    this.lastAt = now;
    return true;
  }
}
