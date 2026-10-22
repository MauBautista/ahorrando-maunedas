package com.maubautista.maunedas.core.ui

import com.maubautista.maunedas.core.model.HouseholdTime
import java.time.Instant
import java.time.LocalDate
import java.time.YearMonth
import java.time.ZonedDateTime
import java.time.temporal.ChronoUnit

/**
 * Dates in Mexican Spanish, in Mexico City time (CLAUDE.md rules 2 and 14). The names are written here, not
 * taken from the locale: the device's ICU data and the JVM's disagree ("oct" or "oct.").
 */
object Dates {
    private val MONTHS =
        listOf("enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre")
    private val SHORT_MONTHS = listOf("ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic")
    private val SHORT_DAYS = listOf("lun", "mar", "mié", "jue", "vie", "sáb", "dom")
    private val DAYS = listOf("lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo")

    fun monthName(month: YearMonth): String = MONTHS[month.monthValue - 1]

    /** As the phone shows the time: "14:30" with a 24-hour clock, "2:30 p.m." with a 12-hour one. */
    fun time(
        at: Long,
        clock24h: Boolean,
    ): String =
        local(at).let {
            if (clock24h) {
                "%d:%02d".format(it.hour, it.minute)
            } else {
                "%d:%02d %s".format((it.hour + 11) % 12 + 1, it.minute, if (it.hour < 12) "a.m." else "p.m.")
            }
        }

    /** "Hoy, 14:30" · "Ayer, 9:05 a.m." · "lun 20 oct" in the current year · "20 oct 2025" before it. */
    fun day(
        at: Long,
        now: Long,
        clock24h: Boolean,
    ): String {
        val date = local(at)
        val today = local(now).toLocalDate()
        return when (date.toLocalDate()) {
            today -> "Hoy, ${time(at, clock24h)}"
            today.minusDays(1) -> "Ayer, ${time(at, clock24h)}"
            else ->
                if (date.year == today.year) {
                    "${SHORT_DAYS[date.dayOfWeek.value - 1]} ${date.dayOfMonth} ${SHORT_MONTHS[date.monthValue - 1]}"
                } else {
                    "${date.dayOfMonth} ${SHORT_MONTHS[date.monthValue - 1]} ${date.year}"
                }
        }
    }

    /** "20 oct" in the current year, "20 oct 2025" before it (chart axes, lists). */
    fun shortDate(
        at: Long,
        now: Long,
    ): String {
        val date = local(at)
        val base = "${date.dayOfMonth} ${SHORT_MONTHS[date.monthValue - 1]}"
        return if (date.year == local(now).year) base else "$base ${date.year}"
    }

    /** Heading of a day in a list: "Hoy", "Ayer", "martes 20 de octubre", "20 de octubre de 2025" before this year. */
    fun dayTitle(
        at: Long,
        now: Long,
    ): String {
        val date = local(at).toLocalDate()
        val today = local(now).toLocalDate()
        return when {
            date == today -> "Hoy"
            date == today.minusDays(1) -> "Ayer"
            date.year == today.year -> "${DAYS[date.dayOfWeek.value - 1]} ${date.dayOfMonth} de ${MONTHS[date.monthValue - 1]}"
            else -> "${date.dayOfMonth} de ${MONTHS[date.monthValue - 1]} de ${date.year}"
        }
    }

    /** [shortDate] of a calendar day given as [HouseholdTime.epochDay]. */
    fun shortDateOfDay(
        epochDay: Long,
        now: Long,
    ): String = shortDate(LocalDate.ofEpochDay(epochDay).atTime(12, 0).atZone(HouseholdTime.ZONE).toInstant().toEpochMilli(), now)

    /** How old a datum is, by calendar days in Mexico City: "hoy", "ayer", "hace 3 días", "hace 2 semanas", "hace 2 meses". */
    fun ago(
        at: Long,
        now: Long,
    ): String {
        val days = ChronoUnit.DAYS.between(local(at).toLocalDate(), local(now).toLocalDate())
        return when {
            days <= 0 -> "hoy"
            days == 1L -> "ayer"
            days < 14 -> "hace $days días"
            days < 60 -> "hace ${days / 7} semanas"
            else -> "hace ${days / 30} meses"
        }
    }

    private fun local(at: Long): ZonedDateTime = Instant.ofEpochMilli(at).atZone(HouseholdTime.ZONE)
}
