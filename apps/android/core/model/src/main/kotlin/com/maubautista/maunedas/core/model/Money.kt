package com.maubautista.maunedas.core.model

import java.math.BigDecimal
import java.text.NumberFormat
import java.util.Locale

/**
 * Money is cents (CLAUDE.md rule 1). Typed amounts are parsed as text, never through a float, and shown in
 * es-MX (05 §7): "$1,234.50".
 */
object Money {
    private val MX: Locale = Locale.forLanguageTag("es-MX")

    /** "$1,234.50" for 123450. */
    fun format(cents: Long): String = NumberFormat.getCurrencyInstance(MX).format(BigDecimal.valueOf(cents, 2))

    /** "28.50" for 2850: the text a money field starts with. */
    fun plain(cents: Long): String = BigDecimal.valueOf(cents, 2).toPlainString()

    /**
     * Cents of a typed price: "28.5", "28,5", "$1,234.50" or "1.234,50"; at most 2 decimals, not negative.
     * Null when it is not a price.
     */
    fun parseCents(input: String): Long? {
        val number = DecimalText.parse(input, maxDecimals = 2) ?: return null
        return number.movePointRight(2).longValueExact()
    }
}

/** Quantities of a purchase line (05 §7): pieces or kg/L sold by weight, with up to 3 decimals. */
object Quantities {
    /** "0.845", "1,5" or "2" → a positive quantity; null otherwise. */
    fun parse(input: String): Double? = DecimalText.parse(input, maxDecimals = 3)?.takeIf { it.signum() > 0 }?.toDouble()
}

/** Decimal text typed with either separator (the phone keyboard shows "." or ","). */
internal object DecimalText {
    private val NOISE = Regex("[\\s\\u00A0$]")
    private val DIGITS = Regex("\\d+")

    fun parse(
        input: String,
        maxDecimals: Int,
    ): BigDecimal? {
        val s = input.replace(NOISE, "")
        if (s.isEmpty()) return null
        val lastDot = s.lastIndexOf('.')
        val lastComma = s.lastIndexOf(',')
        // The rightmost separator is the decimal one when both appear or it appears once; repeated, they group.
        val decimalAt =
            when {
                lastDot >= 0 && lastComma >= 0 -> maxOf(lastDot, lastComma)
                lastDot >= 0 -> if (s.count { it == '.' } == 1) lastDot else -1
                lastComma >= 0 -> if (s.count { it == ',' } == 1) lastComma else -1
                else -> -1
            }
        val whole = (if (decimalAt >= 0) s.substring(0, decimalAt) else s).replace(".", "").replace(",", "")
        val fraction = if (decimalAt >= 0) s.substring(decimalAt + 1) else ""
        if (!DIGITS.matches(whole.ifEmpty { "0" }) || (fraction.isNotEmpty() && !DIGITS.matches(fraction))) return null
        if (fraction.length > maxDecimals) return null
        return BigDecimal("${whole.ifEmpty { "0" }}.${fraction.ifEmpty { "0" }}").stripTrailingZeros().let {
            if (it.scale() < 0) it.setScale(0) else it
        }
    }
}
