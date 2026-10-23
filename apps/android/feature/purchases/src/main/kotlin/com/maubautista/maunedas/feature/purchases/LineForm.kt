package com.maubautista.maunedas.feature.purchases

import androidx.annotation.StringRes
import com.maubautista.maunedas.core.data.LinePromotion
import com.maubautista.maunedas.core.data.LineVariant
import com.maubautista.maunedas.core.data.PurchaseLine
import com.maubautista.maunedas.core.data.VariantChoice
import com.maubautista.maunedas.core.pricing.PromoParams
import com.maubautista.maunedas.core.pricing.PromoType
import com.maubautista.maunedas.core.pricing.Promotions
import kotlin.math.floor

/**
 * S-05 as typed. The promotion's discount is `Promotions.discount()` of its parameters; typing a discount by hand
 * replaces it and saves the line as `other` with that amount (05 §5).
 */
data class LineForm(
    val lineId: String? = null,
    val variant: LineVariant? = null,
    val rawText: String? = null,
    val query: String = "",
    val results: List<VariantChoice> = emptyList(),
    val quantity: Double? = 1.0,
    val unitPriceCents: Long? = null,
    val promoType: PromoType? = null,
    val params: PromoParams = PromoParams(),
    val manualDiscountCents: Long? = null,
    @StringRes val error: Int? = null,
) {
    fun withVariant(choice: VariantChoice): LineForm =
        copy(
            variant = choice.variant,
            query = "",
            results = emptyList(),
            // Bulk is weighed; anything else starts at one piece.
            quantity = if (choice.variant.soldByWeight) null else quantity?.takeIf { it >= 1 && it == floor(it) } ?: 1.0,
            unitPriceCents = unitPriceCents ?: choice.lastPriceCents,
            error = null,
        )

    fun withQuantity(value: Double?) = copy(quantity = value, error = null)

    /** The stepper: whole pieces, at least one. */
    fun step(delta: Int) = copy(quantity = ((quantity ?: 0.0) + delta).coerceAtLeast(1.0), error = null)

    fun withPrice(cents: Long?) = copy(unitPriceCents = cents, error = null)

    fun withPromo(type: PromoType?) = copy(promoType = type, params = PromoParams(), manualDiscountCents = null, error = null)

    fun withParams(change: (PromoParams) -> PromoParams) = copy(params = change(params), error = null)

    fun withManualDiscount(cents: Long?) = copy(manualDiscountCents = cents, error = null)

    /** price_cut starts from the list price; the rest of the parameters are what was typed. */
    private fun effectiveParams(): PromoParams = if (promoType == PromoType.PRICE_CUT) params.copy(fromCents = unitPriceCents?.toDouble()) else params

    /** The promotion's discount, or null while its parameters are incomplete (`Promotions.discount` throws then). */
    fun computedDiscount(): Long? {
        val type = promoType ?: return null
        val q = quantity ?: return null
        val price = unitPriceCents ?: return null
        return runCatching { Promotions.discount(type, effectiveParams(), q, price) }.getOrNull()
    }

    /** The promotion as it will be saved: typed by hand → `other` with that amount. */
    fun promotion(): LinePromotion? {
        val type = promoType ?: return null
        manualDiscountCents?.let { return LinePromotion(type = PromoType.OTHER, params = PromoParams(amountCents = it.toDouble()), discountCents = it) }
        val discount = computedDiscount() ?: return null
        return LinePromotion(type = type, params = effectiveParams(), discountCents = discount)
    }

    /** The line as it would be saved now, for the live totals; null while something is missing. */
    fun preview(): PurchaseLine? {
        val q = quantity?.takeIf { it > 0 } ?: return null
        val price = unitPriceCents ?: return null
        return PurchaseLine(lineId, variant, rawText, q, price, promotion())
    }

    /** The line to save, or this form with what is missing. */
    fun validate(): Pair<PurchaseLine?, LineForm> {
        val problem =
            when {
                variant == null && rawText == null -> R.string.line_need_variant
                quantity == null || quantity <= 0 -> R.string.line_need_quantity
                unitPriceCents == null -> R.string.line_need_price
                promoType != null && manualDiscountCents == null && computedDiscount() == null -> R.string.promo_missing
                else -> null
            }
        if (problem != null) return null to copy(error = problem)
        return preview() to this
    }

    companion object {
        fun of(line: PurchaseLine): LineForm {
            val promo = line.promotion
            // A saved `other` comes back as typed by hand.
            val manual = promo?.takeIf { it.type == PromoType.OTHER }?.discountCents
            return LineForm(
                lineId = line.id,
                variant = line.variant,
                rawText = line.rawText,
                quantity = line.quantity,
                unitPriceCents = line.unitPriceCents,
                promoType = promo?.type,
                params = promo?.params ?: PromoParams(),
                manualDiscountCents = manual,
            )
        }
    }
}
