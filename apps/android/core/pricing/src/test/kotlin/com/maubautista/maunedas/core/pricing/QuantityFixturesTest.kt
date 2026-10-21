package com.maubautista.maunedas.core.pricing

import com.maubautista.maunedas.core.model.Measure
import kotlinx.serialization.json.JsonNull
import org.junit.Assert.assertEquals
import org.junit.Test

class QuantityFixturesTest {
    private val fixture = Fixtures.load("cantidades.json")

    @Test
    fun cantidades() =
        checkAll(fixture("casos").array().map { it.obj() }, { "\"${it("entrada").str()}\"" }) { c ->
            val parsed = QuantityParser.parse(c("entrada").str())
            val e = c("esperado")
            val expected =
                if (e is JsonNull) {
                    null
                } else {
                    val o = e.obj()
                    ParsedQuantity(Measure.fromWire(o("measure").str()), o("unit_amount").num(), o("pack_count").num().toInt())
                }
            assertEquals(expected, parsed)
            val label = c["etiqueta"]
            if (parsed != null && label != null) assertEquals(label.str(), QuantityParser.suggestVariantLabel(parsed))
        }
}
