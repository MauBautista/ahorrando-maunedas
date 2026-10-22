package com.maubautista.maunedas.core.data

import com.maubautista.maunedas.core.database.AppDatabase
import com.maubautista.maunedas.core.model.Clock
import com.maubautista.maunedas.core.model.DisplayUnit
import com.maubautista.maunedas.core.model.Measure
import com.maubautista.maunedas.core.pricing.Units
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

/** How far back the history goes; null days is everything. The API's default is a year (03 §7). */
enum class HistoryPeriod(
    val days: Int?,
) {
    THREE_MONTHS(90),
    YEAR(365),
    ALL(null),
}

/** What to show: a period, some sources (purchase, shelf, web) and maybe one store. */
data class HistoryFilter(
    val period: HistoryPeriod = HistoryPeriod.YEAR,
    val sources: Set<String> = setOf("purchase", "shelf", "web"),
    val storeId: String? = null,
)

data class HistoryPoint(
    val pointId: String,
    val source: String,
    val storeId: String,
    val storeName: String?,
    val observedAt: Long,
    val listUnitCents: Long,
    val effectiveUnitCents: Long?,
    /** Per [VariantHistory.unit], as `display_cents`. */
    val displayCents: Long,
    val hasPromo: Boolean,
)

/** A store that has prices of the variant, for the store filter. */
data class HistoryStore(
    val id: String,
    val name: String?,
)

data class VariantHistory(
    val unit: DisplayUnit,
    /** Oldest first, as the chart draws them. */
    val points: List<HistoryPoint>,
    /** Stores with any price of the variant, whatever the filter. */
    val stores: List<HistoryStore>,
)

/** RF-PRE-02 from Room, with the rules of `GET /v1/variants/:id/history` (03 §7). */
@Singleton
class VariantHistoryRepository
    @Inject
    constructor(
        private val db: AppDatabase,
        private val clock: Clock,
    ) {
        /** [productUnit] is the product's display unit; a variant of another measure shows in its own (03 §3). */
        fun history(
            variantId: String,
            productUnit: DisplayUnit,
            filter: HistoryFilter,
        ): Flow<VariantHistory> =
            db.productPage().variantPoints(variantId).map { rows ->
                val to = clock.nowMillis()
                val from = filter.period.days?.let { to - it * DAY_MS } ?: Long.MIN_VALUE
                val measure = rows.firstOrNull()?.let { Measure.fromWire(it.measure) } ?: productUnit.measure
                val unit = if (productUnit.measure == measure) productUnit else Units.defaultDisplayUnit(measure)
                VariantHistory(
                    unit = unit,
                    points =
                        rows
                            .filter { it.observedAt in from..to && it.source in filter.sources && (filter.storeId == null || it.storeId == filter.storeId) }
                            .map {
                                HistoryPoint(
                                    it.pointId, it.source, it.storeId, it.storeName, it.observedAt, it.listUnitCents, it.effectiveUnitCents,
                                    Units.displayCents(it.centsPerBase, measure, unit), it.hasPromo,
                                )
                            },
                    stores = rows.distinctBy { it.storeId }.map { HistoryStore(it.storeId, it.storeName) }.sortedBy { it.name.orEmpty().lowercase() },
                )
            }

        private companion object {
            const val DAY_MS = 86_400_000L
        }
    }
