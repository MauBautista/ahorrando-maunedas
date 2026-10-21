package com.maubautista.maunedas.core.pricing

import com.maubautista.maunedas.core.model.JS_SPACE
import com.maubautista.maunedas.core.model.trimJs
import kotlin.math.floor

enum class PromoType(val wire: String) {
    PRICE_CUT("price_cut"),
    PERCENT("percent"),
    NXM("nxm"),
    NTH_UNIT_DISCOUNT("nth_unit_discount"),
    MEMBER_PRICE("member_price"),
    COUPON("coupon"),
    MSI("msi"),
    BUNDLE("bundle"),
    OTHER("other"),
    ;

    companion object {
        fun fromWire(value: String): PromoType =
            entries.firstOrNull { it.wire == value } ?: throw IllegalArgumentException("Promoción desconocida: $value")
    }
}

/** `promotions.params` (esquema-d1.sql); only the fields of the given type are used. */
data class PromoParams(
    val fromCents: Double? = null,
    val toCents: Double? = null,
    val percent: Double? = null,
    val n: Double? = null,
    val m: Double? = null,
    val nth: Double? = null,
    val memberCents: Double? = null,
    val program: String? = null,
    val code: String? = null,
    val amountCents: Double? = null,
    val months: Double? = null,
    val text: String? = null,
)

data class PromoGuess(val type: PromoType, val params: PromoParams)

/** Promotions (SDD 09 §6, promociones.json), same formulas and order as `packages/shared/src/pricing/promotions.ts`. */
object Promotions {
    private fun required(
        value: Double?,
        key: String,
        type: PromoType,
    ): Double =
        value?.takeIf { it.isFinite() } ?: throw IllegalArgumentException("La promoción ${type.wire} requiere $key")

    /** Line discount in cents, rounded half-up and bounded to [0, gross] with gross = round(quantity × unit price). */
    fun discount(
        type: PromoType,
        params: PromoParams,
        quantity: Double,
        unitPriceCents: Long,
    ): Long {
        val raw = rawDiscount(type, params, quantity, unitPriceCents.toDouble())
        val gross = roundHalfUp(quantity * unitPriceCents)
        return minOf(maxOf(roundHalfUp(raw), 0L), gross)
    }

    private fun rawDiscount(
        type: PromoType,
        p: PromoParams,
        quantity: Double,
        unitPriceCents: Double,
    ): Double =
        when (type) {
            PromoType.PRICE_CUT -> (required(p.fromCents, "from_cents", type) - required(p.toCents, "to_cents", type)) * quantity
            PromoType.PERCENT -> unitPriceCents * quantity * required(p.percent, "percent", type) / 100
            PromoType.NXM -> {
                val n = required(p.n, "n", type)
                val m = required(p.m, "m", type)
                floor(quantity / n) * (n - m) * unitPriceCents
            }
            PromoType.NTH_UNIT_DISCOUNT ->
                floor(quantity / required(p.nth, "nth", type)) * unitPriceCents * required(p.percent, "percent", type) / 100
            PromoType.MEMBER_PRICE -> (unitPriceCents - required(p.memberCents, "member_cents", type)) * quantity
            PromoType.COUPON -> p.amountCents ?: (unitPriceCents * quantity * required(p.percent, "percent", type) / 100)
            PromoType.MSI -> 0.0
            PromoType.BUNDLE, PromoType.OTHER -> p.amountCents ?: 0.0
        }

    /** Interest-free months (MSI) are recorded but never change the price. */
    fun affectsPrice(type: PromoType): Boolean = type != PromoType.MSI

    private val SPACES = Regex("$JS_SPACE+")
    private val MSI_MONTHS = Regex("(\\d+)$JS_SPACE*(?:MSI|MESES SIN INTERESES)\\b")
    private val MSI_ANY = Regex("\\bMSI\\b|MESES SIN INTERESES")
    private val NXM = Regex("\\b([2-9])$JS_SPACE*X$JS_SPACE*([1-8])\\b")
    private val NTH_UNIT = Regex("\\b(?:2DA|SEGUNDA|2A)\\b.*?(\\d{1,3})$JS_SPACE*%")
    private val MEMBER = Regex("SOCIO|MEMBRESIA|MEMBER")
    private val COUPON = Regex("CUPON|COUPON")
    private val PERCENT = Regex("(\\d{1,3})$JS_SPACE*%")
    private val PRICE_CUT = Regex("REBAJA|AHORRO|DESC|DESCUENTO|BAJA DE PRECIO")

    /**
     * Classifies the promotion text printed on a receipt (SDD 09 §6.2), checking the patterns in order.
     * Empty text → null; non-empty text without a known pattern → OTHER.
     */
    fun detect(text: String?): PromoGuess? {
        val clean = (text ?: "").replace(SPACES, " ").trimJs()
        if (clean.isEmpty()) return null
        val t = foldAccents(clean).uppercase()

        MSI_MONTHS.find(t)?.let { return PromoGuess(PromoType.MSI, PromoParams(months = it.groupValues[1].toDouble())) }
        if (MSI_ANY.containsMatchIn(t)) return PromoGuess(PromoType.MSI, PromoParams())

        NXM.find(t)?.let {
            val n = it.groupValues[1].toDouble()
            val m = it.groupValues[2].toDouble()
            if (n > m) return PromoGuess(PromoType.NXM, PromoParams(n = n, m = m))
        }
        NTH_UNIT.find(t)?.let {
            return PromoGuess(PromoType.NTH_UNIT_DISCOUNT, PromoParams(nth = 2.0, percent = it.groupValues[1].toDouble()))
        }
        if (MEMBER.containsMatchIn(t)) return PromoGuess(PromoType.MEMBER_PRICE, PromoParams())
        if (COUPON.containsMatchIn(t)) return PromoGuess(PromoType.COUPON, PromoParams())
        PERCENT.find(t)?.let { return PromoGuess(PromoType.PERCENT, PromoParams(percent = it.groupValues[1].toDouble())) }
        if (PRICE_CUT.containsMatchIn(t)) return PromoGuess(PromoType.PRICE_CUT, PromoParams())
        return PromoGuess(PromoType.OTHER, PromoParams(text = clean))
    }
}
