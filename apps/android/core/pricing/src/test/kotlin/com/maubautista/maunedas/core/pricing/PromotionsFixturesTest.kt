package com.maubautista.maunedas.core.pricing

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class PromotionsFixturesTest {
    private val fixture = Fixtures.load("promociones.json")

    private fun params(o: JsonObject): PromoParams {
        val known = setOf("from_cents", "to_cents", "percent", "n", "m", "nth", "member_cents", "program", "code", "amount_cents", "months", "text")
        val unknown = o.keys - known
        require(unknown.isEmpty()) { "Parámetros desconocidos: $unknown" }
        return PromoParams(
            fromCents = o["from_cents"]?.num(),
            toCents = o["to_cents"]?.num(),
            percent = o["percent"]?.num(),
            n = o["n"]?.num(),
            m = o["m"]?.num(),
            nth = o["nth"]?.num(),
            memberCents = o["member_cents"]?.num(),
            program = o["program"]?.str(),
            code = o["code"]?.str(),
            amountCents = o["amount_cents"]?.num(),
            months = o["months"]?.num(),
            text = o["text"]?.str(),
        )
    }

    @Test
    fun descuentos() =
        checkAll(fixture("descuentos").array().map { it.obj() }, { it("nombre").str() }) { c ->
            val discount =
                Promotions.discount(PromoType.fromWire(c("type").str()), params(c("params").obj()), c("quantity").num(), c("unit_price_cents").num().toLong())
            assertEquals(c("esperado").num().toLong(), discount)
        }

    @Test
    fun deteccion() =
        checkAll(fixture("deteccion").array().map { it.obj() }, { "\"${it("texto").str()}\"" }) { c ->
            val expected = if (c("type") is JsonNull) null else PromoGuess(PromoType.fromWire(c("type").str()), params(c("params").obj()))
            assertEquals(expected, Promotions.detect(c("texto").str()))
        }

    @Test
    fun requiresTheParametersOfTheType() {
        assertThrows(IllegalArgumentException::class.java) { Promotions.discount(PromoType.NXM, PromoParams(n = 2.0), 2.0, 100) }
    }

    @Test
    fun neverDiscountsMoreThanTheLineGross() {
        assertEquals(3000L, Promotions.discount(PromoType.COUPON, PromoParams(amountCents = 5000.0), 1.0, 3000))
    }

    @Test
    fun msiDoesNotAffectThePrice() {
        assertFalse(Promotions.affectsPrice(PromoType.MSI))
        assertTrue(Promotions.affectsPrice(PromoType.NXM))
    }
}
