package com.maubautista.maunedas.core.pricing

import com.maubautista.maunedas.core.model.JS_SPACE
import com.maubautista.maunedas.core.model.trimJs

/** `receipt_aliases.raw_text_norm` of a receipt line (SDD 09 §5.1), same steps as `normalizeReceiptText`. */
object ReceiptText {
    private val SPACES = Regex("$JS_SPACE+")
    private val LEADING_CODE = Regex("^\\d{8,14}$JS_SPACE+")
    private val TRAILING_CODE = Regex("$JS_SPACE+\\d{8,14}$")
    private val QUANTITY_PREFIX = Regex("^\\d+(?:\\.\\d+)?$JS_SPACE*(?:X|@|\\*)$JS_SPACE+")
    private val TRAILING_PRICE = Regex("$JS_SPACE+\\$?\\d+[.,]\\d{2}$")
    private val SCALE_WEIGHT = Regex("\\b\\d+\\.\\d{3}$JS_SPACE*KG\\b")
    private val NOT_ALLOWED = Regex("[^A-Z0-9 %.]")
    private val DOT_NOT_BETWEEN_DIGITS = Regex("(?<!\\d)\\.|\\.(?!\\d)")

    private fun collapse(s: String) = s.replace(SPACES, " ").trimJs()

    /** What the extraction writes for a line it cannot read (09 §4.2); such a line never teaches an alias (09 §7). */
    const val ILLEGIBLE = "ILEGIBLE"

    /** "2 @ PAN BIMBO BLANCO 14.25 28.50" → "PAN BIMBO BLANCO". */
    fun normalize(raw: String): String {
        var s = collapse(foldAccents(raw).uppercase()) // 1
        s = s.replaceFirst(LEADING_CODE, "").replaceFirst(TRAILING_CODE, "") // 2
        s = s.replaceFirst(QUANTITY_PREFIX, "") // 3
        s = s.replaceFirst(TRAILING_PRICE, "").replaceFirst(TRAILING_PRICE, "") // 4: up to two prices
        s = s.replace(SCALE_WEIGHT, " ") // 5
        s = s.replace(NOT_ALLOWED, " ").replace(DOT_NOT_BETWEEN_DIGITS, "") // 6
        return collapse(s) // 7
    }
}
