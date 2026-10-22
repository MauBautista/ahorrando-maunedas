package com.maubautista.maunedas.core.pricing

import com.maubautista.maunedas.core.model.DisplayUnit
import com.maubautista.maunedas.core.model.Measure
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class BestPricesTest {
    private fun point(
        id: String,
        variant: String,
        store: String,
        at: Long,
        perBase: Double,
        measure: Measure = Measure.VOLUME,
    ) = PricePoint(id, "purchase", variant, variant, measure, store, null, at, perBase)

    @Test
    fun onlyTheNewestPointOfEachVariantAndStoreCompetes() {
        // An older, cheaper point of the same variant and store does not count.
        val best = BestPrices.pick(listOf(point("a", "1L", "walmart", 10, 1.0), point("b", "1L", "walmart", 20, 2.85), point("c", "6L", "costco", 15, 2.65)), DisplayUnit.L)
        assertEquals("c", best?.pointId)
    }

    @Test
    fun variantsOfAnotherMeasureNeverWin() {
        val points = listOf(point("kg", "1 kg", "s", 1, 0.3, Measure.MASS), point("pz", "10 sobres", "s", 1, 0.01, Measure.COUNT))
        assertEquals("kg", BestPrices.pick(points, DisplayUnit.KG)?.pointId)
        assertNull(BestPrices.pick(points.drop(1), DisplayUnit.KG))
    }

    @Test
    fun tiesGoToTheNewerPointThenToTheGreaterId() {
        assertEquals("new", BestPrices.pick(listOf(point("old", "a", "s1", 1, 2.0), point("new", "b", "s2", 2, 2.0)), DisplayUnit.L)?.pointId)
        assertEquals("p2", BestPrices.pick(listOf(point("p2", "a", "s1", 5, 2.0), point("p1", "b", "s2", 5, 2.0)), DisplayUnit.L)?.pointId)
        // Within one (variant, store) the same tie-break picks the newest point.
        assertEquals("z", BestPrices.pick(listOf(point("z", "a", "s1", 5, 9.0), point("y", "a", "s1", 5, 1.0)), DisplayUnit.L)?.pointId)
    }

    @Test
    fun noPointsNoBest() {
        assertNull(BestPrices.pick(emptyList(), DisplayUnit.PZ))
    }
}
