package com.maubautista.maunedas.core.model

import java.time.Instant
import java.time.LocalDate
import java.time.YearMonth
import java.time.ZoneId

/** `[from, until)` in epoch ms. */
data class TimeSpan(
    val from: Long,
    val until: Long,
)

/** Times are stored in epoch ms UTC and shown in Mexico City (CLAUDE.md rule 2). */
object HouseholdTime {
    val ZONE: ZoneId = ZoneId.of("America/Mexico_City")

    fun monthOf(at: Long): YearMonth = YearMonth.from(Instant.ofEpochMilli(at).atZone(ZONE))

    /** From the first instant of [first] to the first instant after [last], calendar days in Mexico City. */
    fun days(
        first: LocalDate,
        last: LocalDate,
    ): TimeSpan = TimeSpan(first.atStartOfDay(ZONE).toInstant().toEpochMilli(), last.plusDays(1).atStartOfDay(ZONE).toInstant().toEpochMilli())

    /** The calendar day of [at] in Mexico City, as days since 1970-01-01 (the x of the history chart). */
    fun epochDay(at: Long): Long = Instant.ofEpochMilli(at).atZone(ZONE).toLocalDate().toEpochDay()

    /** From the first instant of the month in Mexico City to the first of the next one. */
    fun span(month: YearMonth): TimeSpan =
        TimeSpan(
            from = month.atDay(1).atStartOfDay(ZONE).toInstant().toEpochMilli(),
            until = month.plusMonths(1).atDay(1).atStartOfDay(ZONE).toInstant().toEpochMilli(),
        )
}
