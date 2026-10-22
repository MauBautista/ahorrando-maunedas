package com.maubautista.maunedas.feature.purchases

import androidx.paging.PagingData
import androidx.paging.testing.asSnapshot
import com.maubautista.maunedas.core.data.PurchaseSummary
import com.maubautista.maunedas.core.model.TimeSpan
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.Instant
import java.time.LocalDate

class PurchaseListTest {
    private fun at(iso: String) = Instant.parse(iso).toEpochMilli()

    private val now = at("2026-10-22T18:00:00Z")

    private fun purchase(
        id: String,
        iso: String,
    ) = PurchaseSummary(id, "Soriana", null, at(iso), 100, 1, false)

    @Test
    fun purchasesAreGroupedByMexicoCityDay() =
        runTest {
            val list =
                listOf(
                    purchase("a", "2026-10-22T20:00:00Z"),
                    purchase("b", "2026-10-22T06:00:00Z"),
                    // 05:59 UTC on the 22nd is the 21st in Mexico City: a new day.
                    purchase("c", "2026-10-22T05:59:00Z"),
                    purchase("d", "2026-10-20T18:00:00Z"),
                )
            val keys = flowOf(PagingData.from(list)).map { it.groupedByDay() }.asSnapshot().map { it.key }
            assertEquals(listOf("day:20748", "a", "b", "day:20747", "c", "day:20746", "d"), keys)
        }

    @Test
    fun rangesFollowMexicoCityMonthsAndDays() {
        // October 2026 starts at 06:00 UTC on the 1st.
        assertEquals(TimeSpan(at("2026-10-01T06:00:00Z"), at("2026-11-01T06:00:00Z")), DateRange.ThisMonth.span(now))
        assertEquals(TimeSpan(at("2026-09-01T06:00:00Z"), at("2026-10-01T06:00:00Z")), DateRange.LastMonth.span(now))
        assertEquals(TimeSpan(at("2026-08-01T06:00:00Z"), at("2026-11-01T06:00:00Z")), DateRange.LastThreeMonths.span(now))
        assertNull(DateRange.All.span(now))
    }

    @Test
    fun pickedDaysAreWholeMexicoCityDays() {
        // The picker gives midnight UTC of each chosen day.
        val days = DateRange.Days.fromPicker(at("2026-10-05T00:00:00Z"), at("2026-10-07T00:00:00Z"))
        assertEquals(DateRange.Days(LocalDate.of(2026, 10, 5), LocalDate.of(2026, 10, 7)), days)
        assertEquals(TimeSpan(at("2026-10-05T06:00:00Z"), at("2026-10-08T06:00:00Z")), days.span(now))
        // The filter ends one millisecond before the next day.
        val filter = PurchaseFilters(range = days).toFilter(now)
        assertEquals(at("2026-10-05T06:00:00Z") to at("2026-10-08T06:00:00Z") - 1, filter.from to filter.to)
        assertEquals(Long.MIN_VALUE to Long.MAX_VALUE, PurchaseFilters().toFilter(now).let { it.from to it.to })
    }
}
