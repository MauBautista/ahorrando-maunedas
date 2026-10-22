package com.maubautista.maunedas.core.ui

import com.maubautista.maunedas.core.model.HouseholdTime
import java.time.Instant
import java.time.YearMonth
import java.time.ZonedDateTime

/**
 * Dates in Mexican Spanish, in Mexico City time (CLAUDE.md rules 2 and 14). The names are written here, not
 * taken from the locale: the device's ICU data and the JVM's disagree ("oct" or "oct.").
 */
object Dates {
    private val MONTHS =
        listOf("enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre")
    private val SHORT_MONTHS = listOf("ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic")
    private val SHORT_DAYS = listOf("lun", "mar", "mié", "jue", "vie", "sáb", "dom")

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

    private fun local(at: Long): ZonedDateTime = Instant.ofEpochMilli(at).atZone(HouseholdTime.ZONE)
}
