package com.maubautista.maunedas.core.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class MoneyTest {
    @Test
    fun parsesPricesWithEitherDecimalSeparator() {
        val cases =
            mapOf(
                "28.5" to 2850L,
                "28,5" to 2850L,
                "28.50" to 2850L,
                "$ 12" to 1200L,
                "0.05" to 5L,
                ",5" to 50L,
                "1,234.50" to 123450L,
                "1.234,50" to 123450L,
                "1,234,567.89" to 123456789L,
                "1,234,567" to 123456700L,
                "  159 " to 15900L,
            )
        for ((input, cents) in cases) assertEquals(input, cents, Money.parseCents(input))
    }

    @Test
    fun rejectsWhatIsNotAPrice() {
        for (input in listOf("", " ", "abc", "12.345", "-5", "1.2.3,4.5a", "12,3x", "$", "1e3")) {
            assertNull(input, Money.parseCents(input))
        }
    }

    @Test
    fun formatsInSpanishMexico() {
        assertEquals("$1,234.50", Money.format(123450))
        assertEquals("$0.05", Money.format(5))
        assertEquals("$0.00", Money.format(0))
        assertEquals("28.50", Money.plain(2850))
    }

    @Test
    fun quantities() {
        assertEquals(0.845, Quantities.parse("0.845")!!, 0.0)
        assertEquals(1.5, Quantities.parse("1,5")!!, 0.0)
        assertEquals(2.0, Quantities.parse("2")!!, 0.0)
        for (input in listOf("0", "0,000", "1.2345", "-1", "x")) assertNull(input, Quantities.parse(input))
    }
}
