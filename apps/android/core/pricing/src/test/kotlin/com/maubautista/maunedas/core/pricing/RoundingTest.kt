package com.maubautista.maunedas.core.pricing

import org.junit.Assert.assertEquals
import org.junit.Test
import kotlin.math.round

class RoundingTest {
    @Test
    fun halfUpLikeTypeScript() {
        assertEquals(listOf(1L, 2L, 3L, 4L, -2L), listOf(0.5, 1.5, 2.5, 3.5, -2.5).map(::roundHalfUp))
        // kotlin.math.round rounds half to even: it would break parity (05 §6).
        assertEquals(listOf(0.0, 2.0, 2.0, 4.0), listOf(0.5, 1.5, 2.5, 3.5).map(::round))
    }

    @Test
    fun jsRoundMatchesMathRound() {
        assertEquals(listOf(0.0, 3.0, -2.0, 1.0), listOf(0.49999999999999994, 2.5, -2.5, 0.5).map(::jsRound))
    }
}
