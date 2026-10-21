package com.maubautista.maunedas.core.pricing

import kotlin.math.floor

/**
 * Half-up rounding to an integer, `floor(x + 0.5)`: the formula of `roundHalfUp` in TypeScript (05 §6).
 * Never `kotlin.math.round` or `roundToLong` here: they round half to even and break parity.
 */
fun roundHalfUp(x: Double): Long = floor(x + 0.5).toLong()

/** `Math.round` of JavaScript: nearest integer, ties toward +∞. */
internal fun jsRound(x: Double): Double {
    val down = floor(x)
    return if (x - down >= 0.5) down + 1 else down
}
