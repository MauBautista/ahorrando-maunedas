package com.maubautista.maunedas.core.pricing

import com.maubautista.maunedas.core.model.DisplayUnit
import com.maubautista.maunedas.core.model.Measure

/** A row of `v_price_points` with its variant and store. */
data class PricePoint(
    val pointId: String,
    val source: String,
    val variantId: String,
    val variantLabel: String,
    val measure: Measure,
    val storeId: String,
    val storeName: String?,
    val observedAt: Long,
    val centsPerBase: Double,
)

/** The "best price" rule (03 §3), as `pickBest` in `apps/api/src/db/queries/prices.ts`. */
object BestPrices {
    /** Only points of the last 90 days take part; the caller filters by `observed_at`. */
    const val WINDOW_MS = 90L * 86_400_000

    /** Newer point first; equal times go to the greatest point id, so the result is deterministic. */
    private fun PricePoint.isNewerThan(other: PricePoint) =
        observedAt > other.observedAt || (observedAt == other.observedAt && pointId > other.pointId)

    /**
     * The newest point of each (variant, store), then the lowest cents per base unit among variants whose measure
     * fits [unit]; ties go to the newer point. Variants of another measure never compete.
     */
    fun pick(
        points: Iterable<PricePoint>,
        unit: DisplayUnit,
    ): PricePoint? {
        val newest = points.groupBy { it.variantId to it.storeId }.values.map { group -> group.reduce { a, b -> if (b.isNewerThan(a)) b else a } }
        var best: PricePoint? = null
        for (p in newest) {
            if (p.measure != unit.measure) continue
            val current = best
            if (current == null || p.centsPerBase < current.centsPerBase || (p.centsPerBase == current.centsPerBase && p.isNewerThan(current))) {
                best = p
            }
        }
        return best
    }
}
