package com.maubautista.maunedas.core.pricing

import com.maubautista.maunedas.core.model.Measure
import org.junit.Assert.assertEquals
import org.junit.Test

class ContentTest {
    @Test
    fun theAssistantSavesBaseUnits() {
        // RF-CAT-02: "6 × 1 L" is unit_amount 1000 with pack_count 6.
        assertEquals(1000.0, Content.toBase(1.0, ContentUnit.L), 0.0)
        assertEquals(1100.0, Content.toBase(1.1, ContentUnit.KG), 0.0)
        assertEquals(946.0, Content.toBase(946.0, ContentUnit.ML), 0.0)
        assertEquals(1500.0, Content.toBase(1.5, ContentUnit.L), 0.0)
        assertEquals(0.5, Content.toBase(0.5, ContentUnit.G), 0.0)
        assertEquals(30.0, Content.toBase(30.0, ContentUnit.PZ), 0.0)
    }

    @Test
    fun savedAmountsComeBackAsTheLabelWouldShowThem() {
        assertEquals(ContentUnit.L to 1.0, Content.forEditing(Measure.VOLUME, 1000.0))
        assertEquals(ContentUnit.ML to 946.0, Content.forEditing(Measure.VOLUME, 946.0))
        assertEquals(ContentUnit.KG to 1.5, Content.forEditing(Measure.MASS, 1500.0))
        assertEquals(ContentUnit.G to 250.0, Content.forEditing(Measure.MASS, 250.0))
        assertEquals(ContentUnit.PZ to 12.0, Content.forEditing(Measure.COUNT, 12.0))
    }

    @Test
    fun eachMeasureOffersItsUnits() {
        assertEquals(listOf(ContentUnit.G, ContentUnit.KG), ContentUnit.of(Measure.MASS))
        assertEquals(listOf(ContentUnit.ML, ContentUnit.L), ContentUnit.of(Measure.VOLUME))
        assertEquals(listOf(ContentUnit.PZ), ContentUnit.of(Measure.COUNT))
    }
}
