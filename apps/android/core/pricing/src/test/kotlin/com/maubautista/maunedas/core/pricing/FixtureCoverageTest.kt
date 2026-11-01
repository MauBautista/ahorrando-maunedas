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

    /** Fixtures of rules Android does not run, with who does. */
    private val elsewhere =
        mapOf(
            // Android resolves links through POST /v1/listings/resolve (T-220).
            "enlaces.json" to "packages/shared urls.fixtures.test.ts and the agent (07 §9)",
        )

    @Test
    fun everyFixtureHasASuite() {
        assertEquals((suites.keys + elsewhere.keys).sorted(), Fixtures.names())
    }
}
