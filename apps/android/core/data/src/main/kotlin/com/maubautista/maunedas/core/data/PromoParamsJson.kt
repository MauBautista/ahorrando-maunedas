package com.maubautista.maunedas.core.data

import com.maubautista.maunedas.core.pricing.PromoParams
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.math.floor

/** `promotions.params` as stored: JSON with the snake_case keys of 09 §6.1; whole numbers without a decimal point. */
internal object PromoParamsJson {
    fun encode(p: PromoParams): String? {
        val fields =
            listOfNotNull(
                p.fromCents?.let { "from_cents" to number(it) },
                p.toCents?.let { "to_cents" to number(it) },
                p.percent?.let { "percent" to number(it) },
                p.n?.let { "n" to number(it) },
                p.m?.let { "m" to number(it) },
                p.nth?.let { "nth" to number(it) },
                p.memberCents?.let { "member_cents" to number(it) },
                p.program?.let { "program" to JsonPrimitive(it) },
                p.code?.let { "code" to JsonPrimitive(it) },
                p.amountCents?.let { "amount_cents" to number(it) },
                p.months?.let { "months" to number(it) },
                p.text?.let { "text" to JsonPrimitive(it) },
            )
        return if (fields.isEmpty()) null else JsonObject(fields.toMap()).toString()
    }

    fun decode(json: String?): PromoParams {
        val o = json?.let { runCatching { Json.parseToJsonElement(it).jsonObject }.getOrNull() } ?: return PromoParams()
        fun num(key: String) = o[key]?.jsonPrimitive?.doubleOrNull
        fun str(key: String) = o[key]?.jsonPrimitive?.takeIf { it.isString }?.content
        return PromoParams(
            fromCents = num("from_cents"),
            toCents = num("to_cents"),
            percent = num("percent"),
            n = num("n"),
            m = num("m"),
            nth = num("nth"),
            memberCents = num("member_cents"),
            program = str("program"),
            code = str("code"),
            amountCents = num("amount_cents"),
            months = num("months"),
            text = str("text"),
        )
    }

    private fun number(x: Double): JsonPrimitive = if (x == floor(x) && kotlin.math.abs(x) < 1e15) JsonPrimitive(x.toLong()) else JsonPrimitive(x)
}
