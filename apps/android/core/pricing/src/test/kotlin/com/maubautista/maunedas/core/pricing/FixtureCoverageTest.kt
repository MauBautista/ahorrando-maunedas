package com.maubautista.maunedas.core.pricing

import org.junit.Assert.assertEquals
import org.junit.Test

/** Every shared fixture has a Kotlin suite; a new fixture cannot be left untested (T-101). */
class FixtureCoverageTest {
    private val suites =
        mapOf(
            "cantidades.json" to "core:pricing QuantityFixturesTest",
            "ids.json" to "core:model UuidsFixturesTest",
            "normalizacion.json" to "core:pricing UnitsFixturesTest, TicketDiscountFixturesTest",
            "promociones.json" to "core:pricing PromotionsFixturesTest",
            "textos.json" to "core:pricing TextFixturesTest",
            "usuarios.json" to "core:model UsernamesFixturesTest",
        )

    @Test
    fun everyFixtureHasASuite() {
        assertEquals(suites.keys.sorted(), Fixtures.names())
    }
}
