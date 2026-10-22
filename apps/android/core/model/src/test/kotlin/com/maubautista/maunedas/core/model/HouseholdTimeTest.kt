package com.maubautista.maunedas.core.model

import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.Instant
import java.time.YearMonth

class HouseholdTimeTest {
    private fun at(iso: String) = Instant.parse(iso).toEpochMilli()

    @Test
    fun aMonthStartsAtMidnightInMexicoCityNotInUtc() {
        // Mexico City is UTC−6 all year since 2022.
        assertEquals(TimeSpan(at("2026-10-01T06:00:00Z"), at("2026-11-01T06:00:00Z")), HouseholdTime.span(YearMonth.of(2026, 10)))
        assertEquals(TimeSpan(at("2026-12-01T06:00:00Z"), at("2027-01-01T06:00:00Z")), HouseholdTime.span(YearMonth.of(2026, 12)))
    }

    @Test
    fun theMonthOfAnInstantIsTheOneOnMexicoCityClocks() {
        assertEquals(YearMonth.of(2026, 9), HouseholdTime.monthOf(at("2026-10-01T05:59:59.999Z")))
        assertEquals(YearMonth.of(2026, 10), HouseholdTime.monthOf(at("2026-10-01T06:00:00Z")))
    }
}
