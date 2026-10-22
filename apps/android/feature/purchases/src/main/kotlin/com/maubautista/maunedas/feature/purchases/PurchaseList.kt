package com.maubautista.maunedas.feature.purchases

import androidx.paging.PagingData
import androidx.paging.insertSeparators
import androidx.paging.map
import com.maubautista.maunedas.core.data.PurchaseSummary
import com.maubautista.maunedas.core.model.HouseholdTime
import com.maubautista.maunedas.core.model.TimeSpan
import java.time.Instant
import java.time.LocalDate
import java.time.YearMonth
import java.time.ZoneOffset

/** A row of S-03: a day heading or a purchase. */
sealed interface PurchaseListItem {
    val key: String

    data class Day(
        val epochDay: Long,
        val at: Long,
    ) : PurchaseListItem {
        override val key: String get() = "day:$epochDay"
    }

    data class Row(
        val purchase: PurchaseSummary,
    ) : PurchaseListItem {
        override val key: String get() = purchase.id
    }
}

/** Groups the purchases (newest first) under a heading per calendar day in Mexico City (05 §5 S-03). */
fun PagingData<PurchaseSummary>.groupedByDay(): PagingData<PurchaseListItem> =
    map<PurchaseSummary, PurchaseListItem> { PurchaseListItem.Row(it) }.insertSeparators { before, after ->
        val next = (after as? PurchaseListItem.Row)?.purchase ?: return@insertSeparators null
        val previous = (before as? PurchaseListItem.Row)?.purchase
        val day = HouseholdTime.epochDay(next.purchasedAt)
        if (previous != null && HouseholdTime.epochDay(previous.purchasedAt) == day) null else PurchaseListItem.Day(day, next.purchasedAt)
    }

/** The date filter of S-03; months and days are Mexico City's. */
sealed interface DateRange {
    /** The span to filter by at [now], or null for every date. */
    fun span(now: Long): TimeSpan?

    data object All : DateRange {
        override fun span(now: Long): TimeSpan? = null
    }

    data object ThisMonth : DateRange {
        override fun span(now: Long) = HouseholdTime.span(HouseholdTime.monthOf(now))
    }

    data object LastMonth : DateRange {
        override fun span(now: Long) = HouseholdTime.span(HouseholdTime.monthOf(now).minusMonths(1))
    }

    /** This month and the two before it. */
    data object LastThreeMonths : DateRange {
        override fun span(now: Long): TimeSpan {
            val month: YearMonth = HouseholdTime.monthOf(now)
            return TimeSpan(HouseholdTime.span(month.minusMonths(2)).from, HouseholdTime.span(month).until)
        }
    }

    /** Both days included. */
    data class Days(
        val first: LocalDate,
        val last: LocalDate,
    ) : DateRange {
        override fun span(now: Long) = HouseholdTime.days(first, last)

        companion object {
            /** The date picker gives each day as midnight UTC. */
            fun fromPicker(
                startUtcMillis: Long,
                endUtcMillis: Long,
            ) = Days(utcDay(startUtcMillis), utcDay(endUtcMillis))

            private fun utcDay(ms: Long) = Instant.ofEpochMilli(ms).atZone(ZoneOffset.UTC).toLocalDate()
        }
    }
}
