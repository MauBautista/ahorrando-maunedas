package com.maubautista.maunedas.core.pricing

import com.maubautista.maunedas.core.model.DisplayUnit
import com.maubautista.maunedas.core.model.Measure
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs

class UnitsFixturesTest {
    private val fixture = Fixtures.load("normalizacion.json")
    private val tolerance = fixture("tolerancia_cents_per_base").num()

    @Test
    fun casos() =
        checkAll(fixture("casos").array().map { it.obj() }, { it("nombre").str() }) { c ->
            val v = c("variante").obj()
            val measure = Measure.fromWire(v("measure").str())
            val cpb = Units.centsPerBase(c("paid_cents").num(), c("quantity").num(), v("unit_amount").num(), v("pack_count").num().toInt())
            val expected = c("esperado").obj()
            assertTrue("cents_per_base $cpb", abs(cpb - expected("cents_per_base").num()) <= tolerance)
            for ((unit, cents) in expected("display").obj()) {
                assertEquals(unit, cents.num().toLong(), Units.displayCents(cpb, measure, DisplayUnit.fromWire(unit)))
            }
        }

    @Test
    fun errores() =
        checkAll(fixture("errores").array().map { it.obj() }, { it("nombre").str() }) { c ->
            val v = c("variante").obj()
            assertThrows(IllegalArgumentException::class.java) {
                val cpb = Units.centsPerBase(c("paid_cents").num(), c("quantity").num(), v("unit_amount").num(), v("pack_count").num().toInt())
                c["display_unit"]?.let { Units.displayCents(cpb, Measure.fromWire(v("measure").str()), DisplayUnit.fromWire(it.str())) }
            }
        }

    @Test
    fun displayUnitsHoldTheFixtureBases() {
        for ((unit, base) in fixture("base_por_unidad_display").obj()) {
            assertEquals(unit, base.num().toInt(), DisplayUnit.fromWire(unit).base)
        }
    }

    @Test
    fun defaultDisplayUnits() {
        assertEquals(listOf(DisplayUnit.KG, DisplayUnit.L, DisplayUnit.PZ), Measure.entries.map(Units::defaultDisplayUnit))
    }
}
