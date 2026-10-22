package com.maubautista.maunedas.core.pricing

import com.maubautista.maunedas.core.model.DisplayUnit
import com.maubautista.maunedas.core.pricing.BestPrices.isNewerThan

/** The newest point of a variant at a store from one source (`latest` of `GET /v1/products/:id`). */
data class LatestPoint(
    val point: PricePoint,
    val displayCents: Long,
    val unit: DisplayUnit,
)

/** One row of the comparator: a variant at a store over the window, in [unit]. */
data class ComparisonRow(
    val last: PricePoint,
    val unit: DisplayUnit,
    val lastCents: Long,
    val min: PricePoint,
    val minCents: Long,
    val avgCents: Long,
    val n: Int,
)

data class Comparison(
    val unit: DisplayUnit,
    val rows: List<ComparisonRow>,
    /** The row with the best price (03 §3), as (variant, store); null without comparable points. */
    val best: Pair<String, String>?,
)

/** The product page (S-08): `latestPoints` and `comparePrices` of `apps/api/src/db/queries/prices.ts`. */
object PriceComparison {
    /** The product's unit, or the default one of the variant's measure when they differ (03 §3). */
    fun unitFor(
        productUnit: DisplayUnit,
        point: PricePoint,
    ): DisplayUnit = if (productUnit.measure == point.measure) productUnit else Units.defaultDisplayUnit(point.measure)

    /** Newest point per (variant, store, source), newest first, without a time window. */
    fun latest(
        points: Iterable<PricePoint>,
        productUnit: DisplayUnit,
    ): List<LatestPoint> =
        points
            .groupBy { Triple(it.variantId, it.storeId, it.source) }
            .values
            .map { group -> group.reduce { a, b -> if (b.isNewerThan(a)) b else a } }
            // Newest first: the order of isNewerThan (time, then point id).
            .sortedWith(compareByDescending<PricePoint> { it.observedAt }.thenByDescending { it.pointId })
            .map { p ->
                val unit = unitFor(productUnit, p)
                LatestPoint(p, Units.displayCents(p.centsPerBase, p.measure, unit), unit)
            }

    /**
     * One row per (variant, store) among [points] (already limited to the window): newest, lowest (ties to the newer)
     * and average price per unit. Comparable rows first, cheapest last price first; then the other measures.
     */
    fun compare(
        points: Iterable<PricePoint>,
        unit: DisplayUnit,
    ): Comparison {
        val rows =
            points.groupBy { it.variantId to it.storeId }.values.map { group ->
                val last = group.reduce { a, b -> if (b.isNewerThan(a)) b else a }
                val min = group.reduce { a, b -> if (b.centsPerBase < a.centsPerBase || (b.centsPerBase == a.centsPerBase && b.isNewerThan(a))) b else a }
                val avg = group.sumOf { it.centsPerBase } / group.size
                val rowUnit = unitFor(unit, last)
                fun show(perBase: Double) = Units.displayCents(perBase, last.measure, rowUnit)
                ComparisonRow(last, rowUnit, show(last.centsPerBase), min, show(min.centsPerBase), show(avg), group.size)
            }.sortedWith(
                compareBy<ComparisonRow> { it.last.measure != unit.measure }
                    .thenBy { it.last.centsPerBase }
                    .thenBy { it.last.variantId }
                    .thenBy { it.last.storeId },
            )
        val best = BestPrices.pick(rows.map { it.last }, unit)
        return Comparison(unit, rows, best?.let { it.variantId to it.storeId })
    }
}
