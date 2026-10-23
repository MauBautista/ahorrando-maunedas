package com.maubautista.maunedas.feature.purchases

import com.maubautista.maunedas.core.data.LineVariant
import com.maubautista.maunedas.core.data.VariantChoice
import com.maubautista.maunedas.core.model.DisplayUnit
import com.maubautista.maunedas.core.model.Measure
import com.maubautista.maunedas.core.pricing.PromoParams
import com.maubautista.maunedas.core.pricing.PromoType
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class LineFormTest {
    private val leche = LineVariant("v1", "p1", "Leche", "1 L", null, Measure.VOLUME, 1000.0, 1, false, DisplayUnit.L)
    private val queso = LineVariant("v2", "p2", "Queso Oaxaca", "A granel (kg)", null, Measure.MASS, 1000.0, 1, true, DisplayUnit.KG)

    /** "Promociones calculadas según fixtures" (T-121): every case of promociones.json through the line form. */
    @Test
    fun theFormGivesTheDiscountsOfTheFixtures() {
        val json = Json.parseToJsonElement(javaClass.getResource("/fixtures/promociones.json")!!.readText()).jsonObject
        for (case in json["descuentos"]!!.jsonArray.map { it.jsonObject }) {
            val p = case["params"]!!.jsonObject
            fun num(key: String) = p[key]?.jsonPrimitive?.double
            val params =
                PromoParams(
                    fromCents = num("from_cents"), toCents = num("to_cents"), percent = num("percent"), n = num("n"), m = num("m"), nth = num("nth"),
                    memberCents = num("member_cents"), amountCents = num("amount_cents"), months = num("months"),
                )
            val form =
                LineForm(variant = leche, quantity = case.num("quantity"), unitPriceCents = case.num("unit_price_cents").toLong())
                    .withPromo(PromoType.fromWire(case["type"]!!.jsonPrimitive.content))
                    .withParams { params }
            assertEquals(case["nombre"]!!.jsonPrimitive.content, case.num("esperado").toLong(), form.computedDiscount())
        }
    }

    private fun JsonObject.num(key: String) = this[key]!!.jsonPrimitive.double

    @Test
    fun aHandTypedDiscountSavesAsOther() {
        val form = LineForm(variant = leche, quantity = 2.0, unitPriceCents = 8_900).withPromo(PromoType.NXM).withParams { it.copy(n = 2.0, m = 1.0) }
        assertEquals(8_900L, form.promotion()?.discountCents)
        val manual = form.withManualDiscount(5_000).promotion()!!
        assertEquals(Triple(PromoType.OTHER, PromoParams(amountCents = 5_000.0), 5_000L), Triple(manual.type, manual.params, manual.discountCents))
        // And comes back as typed by hand.
        val again = LineForm.of(form.withManualDiscount(5_000).validate().first!!)
        assertEquals(5_000L to PromoType.OTHER, again.manualDiscountCents to again.promoType)
    }

    @Test
    fun priceCutStartsFromTheListPrice() {
        val form = LineForm(variant = leche, quantity = 2.0, unitPriceCents = 3_500).withPromo(PromoType.PRICE_CUT).withParams { it.copy(toCents = 2_990.0) }
        assertEquals(1_020L, form.computedDiscount())
        assertEquals(3_500.0, form.promotion()!!.params.fromCents)
    }

    @Test
    fun msiChangesNothingAndBulkIsWeighed() {
        val tv = LineForm(variant = leche, quantity = 1.0, unitPriceCents = 899_900).withPromo(PromoType.MSI).withParams { it.copy(months = 12.0) }
        assertEquals(899_900L, tv.preview()!!.amounts.finalCents)
        // RF-COM-04: 0.845 kg × $32.90 = $27.80, and the last price at the store fills the price.
        val bulk = LineForm().withVariant(VariantChoice(queso, 3_290))
        assertNull(bulk.quantity)
        assertEquals(2_780L, bulk.withQuantity(0.845).preview()!!.amounts.finalCents)
        assertEquals(3_290L, bulk.unitPriceCents)
    }

    @Test
    fun whatIsMissingIsSaid() {
        assertEquals(R.string.line_need_variant, LineForm(quantity = 1.0, unitPriceCents = 100).validate().second.error)
        assertEquals(R.string.line_need_quantity, LineForm(variant = queso, quantity = null, unitPriceCents = 100).validate().second.error)
        assertEquals(R.string.line_need_price, LineForm(variant = leche).validate().second.error)
        assertEquals(R.string.promo_missing, LineForm(variant = leche, unitPriceCents = 100).withPromo(PromoType.NXM).validate().second.error)
        // The stepper never goes below one piece.
        assertEquals(1.0, LineForm(variant = leche, quantity = 1.0).step(-1).quantity)
    }
}
