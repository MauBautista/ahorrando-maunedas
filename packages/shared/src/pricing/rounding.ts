/**
 * Half-up rounding to an integer: `Math.floor(x + 0.5)`.
 * Kotlin must use the same formula (`floor(x + 0.5)` or `Math.round`), never `kotlin.math.round`,
 * which rounds half to even (SDD 05 §6).
 */
export function roundHalfUp(x: number): number {
  return Math.floor(x + 0.5);
}
