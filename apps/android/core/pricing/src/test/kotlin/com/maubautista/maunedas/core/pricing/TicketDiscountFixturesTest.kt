package com.maubautista.maunedas.core.pricing

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs

class TicketDiscountFixturesTest {
    private val fixture = Fixtures.load("normalizacion.json")("prorrateo_ticket").obj()
    private val tolerance = fixture("tolerancia").num()

    @Test
    fun prorrateoTicket() =
        checkAll(fixture("casos").array().map { it.obj() }, { it("nombre").str() }) { c ->
            val lines = c("lineas").array().map { it.obj() }
            val paid = TicketDiscount.prorate(lines.map { it("final_cents").num().toLong() }, c("discount_cents").num().toLong())
            lines.forEachIndexed { i, line ->
                val v = line("variante").obj()
                val expected = line("esperado").obj()
                assertTrue("paid ${paid[i]}", abs(paid[i] - expected("paid_cents").num()) <= tolerance)
                assertEquals(expected("effective_unit_cents").num().toLong(), TicketDiscount.effectiveUnitCents(paid[i], line("quantity").num()))
                val cpb = Units.centsPerBase(paid[i], line("quantity").num(), v("unit_amount").num(), v("pack_count").num().toInt())
                assertTrue("cents_per_base $cpb", abs(cpb - expected("cents_per_base").num()) <= tolerance)
            }
        }

    @Test
    fun rejectsNegativeCentsAndNonPositiveQuantities() {
        assertThrows(IllegalArgumentException::class.java) { TicketDiscount.prorate(listOf(100), -1) }
        assertThrows(IllegalArgumentException::class.java) { TicketDiscount.prorate(listOf(-100), 0) }
        assertThrows(IllegalArgumentException::class.java) { TicketDiscount.effectiveUnitCents(100.0, 0.0) }
        assertEquals(emptyList<Double>(), TicketDiscount.prorate(emptyList(), 500))
    }
}
