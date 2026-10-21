package com.maubautista.maunedas.core.pricing

import com.maubautista.maunedas.core.model.JS_SPACE
import com.maubautista.maunedas.core.model.Measure
import java.math.BigDecimal
import kotlin.math.floor

data class ParsedQuantity(val measure: Measure, val unitAmount: Double, val packCount: Int)

/** Content text of open catalogs (SDD 10 §2.2, cantidades.json), same rules as `catalog/quantity.ts`. */
object QuantityParser {
    private class UnitDef(val measure: Measure, val factor: Double, val integer: Boolean = false)

    // Same order as TypeScript (it decides ties of equal length after sorting).
    private val UNITS: Map<String, UnitDef> =
        linkedMapOf(
            "mg" to UnitDef(Measure.MASS, 0.001),
            "g" to UnitDef(Measure.MASS, 1.0),
            "gr" to UnitDef(Measure.MASS, 1.0),
            "grs" to UnitDef(Measure.MASS, 1.0),
            "gramos" to UnitDef(Measure.MASS, 1.0),
            "kg" to UnitDef(Measure.MASS, 1000.0),
            "kgs" to UnitDef(Measure.MASS, 1000.0),
            "kilo" to UnitDef(Measure.MASS, 1000.0),
            "kilos" to UnitDef(Measure.MASS, 1000.0),
            "oz" to UnitDef(Measure.MASS, 28.3495, integer = true),
            "ml" to UnitDef(Measure.VOLUME, 1.0),
            "mililitros" to UnitDef(Measure.VOLUME, 1.0),
            "cl" to UnitDef(Measure.VOLUME, 10.0),
            "l" to UnitDef(Measure.VOLUME, 1000.0),
            "lt" to UnitDef(Measure.VOLUME, 1000.0),
            "lts" to UnitDef(Measure.VOLUME, 1000.0),
            "litro" to UnitDef(Measure.VOLUME, 1000.0),
            "litros" to UnitDef(Measure.VOLUME, 1000.0),
            "fl oz" to UnitDef(Measure.VOLUME, 29.5735, integer = true),
            "pz" to UnitDef(Measure.COUNT, 1.0),
            "pza" to UnitDef(Measure.COUNT, 1.0),
            "pzas" to UnitDef(Measure.COUNT, 1.0),
            "pieza" to UnitDef(Measure.COUNT, 1.0),
            "piezas" to UnitDef(Measure.COUNT, 1.0),
            "u" to UnitDef(Measure.COUNT, 1.0),
            "unidades" to UnitDef(Measure.COUNT, 1.0),
            "rollos" to UnitDef(Measure.COUNT, 1.0),
            "tabletas" to UnitDef(Measure.COUNT, 1.0),
            "capsulas" to UnitDef(Measure.COUNT, 1.0),
            "sobres" to UnitDef(Measure.COUNT, 1.0),
        )

    // Longest first so "fl oz" wins over "oz" and "litros" over "l".
    private val UNIT = UNITS.keys.sortedByDescending { it.length }.joinToString("|") { it.replace(" ", "$JS_SPACE*") }
    private const val NUM = "\\d+(?:\\.\\d+)?"
    private val S = "$JS_SPACE*"
    private val PACK_FIRST = Regex("(?<![\\d.])(\\d+)${S}x$S($NUM)$S($UNIT)(?![a-z])")
    private val PACK_LAST = Regex("(?<![\\d.])($NUM)$S($UNIT)(?![a-z])${S}x$S(\\d+)(?![\\d.])")
    private val SINGLE = Regex("(?<![\\d.])($NUM)$S($UNIT)(?![a-z])")
    private val DECIMAL_COMMA = Regex("(\\d),(\\d)")
    private val TIMES = Regex("[×*]")
    private val SPACES = Regex("$JS_SPACE+")

    private fun round3(x: Double) = jsRound(x * 1000) / 1000

    private fun def(unitText: String) = UNITS[unitText.replace(SPACES, " ")]

    private fun build(
        amount: String,
        unitText: String,
        pack: String,
    ): ParsedQuantity? {
        val d = def(unitText) ?: return null
        val value = amount.toDouble() * d.factor
        val rounded = if (d.integer) roundHalfUp(value).toDouble() else round3(value)
        val packCount = pack.toDouble()
        if (!(rounded > 0) || !(packCount >= 1)) return null
        return ParsedQuantity(d.measure, rounded, packCount.toInt())
    }

    /** "6 x 1 l" → 6 × 1000 ml. Patterns in order: "N x Q unit", "Q unit x N", "Q unit" (metric before oz). */
    fun parse(text: String?): ParsedQuantity? {
        if (text.isNullOrEmpty()) return null
        val t = foldAccents(text).lowercase().replace(DECIMAL_COMMA, "$1.$2").replace(TIMES, "x")

        PACK_FIRST.find(t)?.let { return build(it.groupValues[2], it.groupValues[3], it.groupValues[1]) }
        PACK_LAST.find(t)?.let { return build(it.groupValues[1], it.groupValues[2], it.groupValues[3]) }

        val singles = SINGLE.findAll(t).toList()
        val preferred = singles.firstOrNull { def(it.groupValues[2])?.integer == false } ?: singles.firstOrNull()
        return preferred?.let { build(it.groupValues[1], it.groupValues[2], "1") }
    }

    /** Suggested variant label: "1 L", "946 ml", "6 × 1 L", "1.5 L", "30 pz". */
    fun suggestVariantLabel(q: ParsedQuantity): String {
        val a = q.unitAmount
        val base =
            when (q.measure) {
                Measure.MASS -> if (a >= 1000) "${fmt(a / 1000)} kg" else "${fmt(a)} g"
                Measure.VOLUME -> if (a >= 1000) "${fmt(a / 1000)} L" else "${fmt(a)} ml"
                Measure.COUNT -> "${fmt(a)} pz"
            }
        return if (q.packCount > 1) "${q.packCount} × $base" else base
    }

    /** `String(round3(x))` of JavaScript for the values labels use: no trailing ".0", no exponent. */
    private fun fmt(x: Double): String {
        val r = round3(x)
        return if (r == floor(r)) r.toLong().toString() else BigDecimal(r.toString()).stripTrailingZeros().toPlainString()
    }
}
