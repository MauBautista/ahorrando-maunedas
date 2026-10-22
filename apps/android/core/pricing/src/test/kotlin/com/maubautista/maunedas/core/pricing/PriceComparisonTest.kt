package com.maubautista.maunedas.core.pricing

import com.maubautista.maunedas.core.model.DisplayUnit
import com.maubautista.maunedas.core.model.Measure
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PriceComparisonTest {
    private fun point(
        id: String,
        variant: String,
        store: String,
        at: Long,
        perBase: Double,
        source: String = "shelf",
        measure: Measure = Measure.VOLUME,
    ) = PricePoint(id, source, variant, variant, measure, store, null, at, perBase)

    @Test
    fun latestKeepsTheNewestPointPerStoreAndSourceNewestFirst() {
        val latest =
            PriceComparison.latest(
                listOf(
                    point("a", "1L", "walmart", 10, 2.85, source = "purchase"),
                    point("b", "1L", "walmart", 5, 1.0, source = "purchase"),
                    point("c", "1L", "walmart", 20, 2.7),
                    point("d", "sobres", "s", 15, 10.0, measure = Measure.COUNT),
                ),
                DisplayUnit.L,
            )
        assertEquals(listOf("c", "d", "a"), latest.map { it.point.pointId })
        assertEquals(listOf(2_700L, 10L, 2_850L), latest.map { it.displayCents })
        // Another measure shows in its own default unit.
        assertEquals(listOf(DisplayUnit.L, DisplayUnit.PZ, DisplayUnit.L), latest.map { it.unit })
    }

    @Test
    fun theMinimumBreaksTiesTowardsTheNewerPointAndRowsBreakTiesById() {
        val c = PriceComparison.compare(listOf(point("old", "v", "s", 1, 2.0), point("new", "v", "s", 2, 2.0), point("x", "a", "z", 3, 2.0), point("y", "a", "b", 3, 2.0)), DisplayUnit.L)
        assertEquals("new", c.rows.first { it.last.variantId == "v" }.min.pointId)
        // Equal last prices: by variant id, then store id.
        assertEquals(listOf("a" to "b", "a" to "z", "v" to "s"), c.rows.map { it.last.variantId to it.last.storeId })
    }

    @Test
    fun withoutPointsThereIsNoBest() {
        val c = PriceComparison.compare(emptyList(), DisplayUnit.PZ)
        assertEquals(emptyList<ComparisonRow>(), c.rows)
        assertNull(c.best)
    }
}
