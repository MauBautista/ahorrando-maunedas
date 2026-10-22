package com.maubautista.maunedas.core.ui

import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.Instant
import java.time.YearMonth

class DatesTest {
    private fun at(iso: String) = Instant.parse(iso).toEpochMilli()

    /** Thursday 22 October 2026, 12:00 in Mexico City. */
    private val now = at("2026-10-22T18:00:00Z")

    @Test
    fun todayAndYesterdayFollowMexicoCityMidnight() {
        assertEquals("Hoy, 0:05", Dates.day(at("2026-10-22T06:05:00Z"), now, clock24h = true))
        // 05:30 UTC on the 22nd is still the 21st in Mexico City.
        assertEquals("Ayer, 23:30", Dates.day(at("2026-10-22T05:30:00Z"), now, clock24h = true))
        assertEquals("Ayer, 9:05 a.m.", Dates.day(at("2026-10-21T15:05:00Z"), now, clock24h = false))
    }

    @Test
    fun olderDaysShowTheWeekdayAndOtherYearsTheYear() {
        assertEquals("mar 20 oct", Dates.day(at("2026-10-20T20:00:00Z"), now, clock24h = false))
        assertEquals("mié 7 ene", Dates.day(at("2026-01-07T20:00:00Z"), now, clock24h = true))
        assertEquals("31 dic 2025", Dates.day(at("2026-01-01T05:00:00Z"), now, clock24h = true))
    }

    @Test
    fun monthNamesAndTimeAreInMexicanSpanish() {
        assertEquals("octubre", Dates.monthName(YearMonth.of(2026, 10)))
        assertEquals("enero", Dates.monthName(YearMonth.of(2026, 1)))
        assertEquals("14:30", Dates.time(at("2026-10-22T20:30:00Z"), clock24h = true))
    }

    @Test
    fun theAgeOfADatumCountsMexicoCityDays() {
        assertEquals("hoy", Dates.ago(at("2026-10-22T06:00:00Z"), now))
        // 23:30 on the 21st in Mexico City, half an hour before midnight: already "ayer".
        assertEquals("ayer", Dates.ago(at("2026-10-22T05:30:00Z"), now))
        assertEquals("hace 3 días", Dates.ago(at("2026-10-19T18:00:00Z"), now))
        assertEquals("hace 13 días", Dates.ago(at("2026-10-09T18:00:00Z"), now))
        assertEquals("hace 2 semanas", Dates.ago(at("2026-10-08T18:00:00Z"), now))
        assertEquals("hace 8 semanas", Dates.ago(at("2026-08-24T18:00:00Z"), now))
        assertEquals("hace 2 meses", Dates.ago(at("2026-08-23T18:00:00Z"), now))
        // A clock a little ahead on another phone is not "in the future".
        assertEquals("hoy", Dates.ago(at("2026-10-23T05:00:00Z"), now))
    }

    @Test
    fun shortDatesAddTheYearOnlyForPastYears() {
        assertEquals("20 oct", Dates.shortDate(at("2026-10-20T20:00:00Z"), now))
        assertEquals("31 dic 2025", Dates.shortDate(at("2026-01-01T05:00:00Z"), now))
        // Day 20746 is 2026-10-20.
        assertEquals("20 oct", Dates.shortDateOfDay(20_746, now))
        assertEquals(20_746L, com.maubautista.maunedas.core.model.HouseholdTime.epochDay(at("2026-10-21T05:59:00Z")))
    }

    @Test
    fun dayTitlesForLists() {
        assertEquals("Hoy", Dates.dayTitle(at("2026-10-22T06:00:00Z"), now))
        assertEquals("Ayer", Dates.dayTitle(at("2026-10-22T05:59:00Z"), now))
        assertEquals("martes 20 de octubre", Dates.dayTitle(at("2026-10-20T18:00:00Z"), now))
        assertEquals("31 de diciembre de 2025", Dates.dayTitle(at("2026-01-01T05:00:00Z"), now))
    }

    @Test
    fun aTwelveHourClockSaysAmOrPmLikeMexicanSpanish() {
        // Midnight and noon are 12, not 0.
        assertEquals("12:05 a.m.", Dates.time(at("2026-10-22T06:05:00Z"), clock24h = false))
        assertEquals("11:59 a.m.", Dates.time(at("2026-10-22T17:59:00Z"), clock24h = false))
        assertEquals("12:00 p.m.", Dates.time(at("2026-10-22T18:00:00Z"), clock24h = false))
        assertEquals("10:46 p.m.", Dates.time(at("2026-10-23T04:46:00Z"), clock24h = false))
    }
}
