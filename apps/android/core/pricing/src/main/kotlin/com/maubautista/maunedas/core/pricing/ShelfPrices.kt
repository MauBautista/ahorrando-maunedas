package com.maubautista.maunedas.core.pricing

import kotlin.math.floor

/**
 * A shelf price with a promotion (S-13, RF-PRE-01): `price_cents` is the regular price per unit shown, and
 * `effective_price_cents` what one unit costs when the promotion applies, at the smallest quantity that triggers it
 * (2 for a 2x1, 3 for a 3x2, the n-th unit…). Same formulas as a purchase line (09 §6.1).
 */
object ShelfPrices {
    /** n for NxM, the n-th unit for nth_unit_discount, otherwise one piece. */
    fun qualifyingQuantity(
        type: PromoType,
        params: PromoParams,
    ): Double =
        when (type) {
            PromoType.NXM -> params.n?.takeIf { it >= 1 }?.let(::floor) ?: 1.0
            PromoType.NTH_UNIT_DISCOUNT -> params.nth?.takeIf { it >= 1 }?.let(::floor) ?: 1.0
            else -> 1.0
        }

    /**
     * The price per unit with the promotion, or null when it does not change the price (MSI) or its parameters are
     * incomplete. price_cut starts from the shelf price, as in S-05.
     */
    fun effective(
        type: PromoType,
        params: PromoParams,
        priceCents: Long,
    ): Long? {
        if (type == PromoType.MSI) return null
        val p = if (type == PromoType.PRICE_CUT) params.copy(fromCents = priceCents.toDouble()) else params
        val q = qualifyingQuantity(type, p)
        val discount = runCatching { Promotions.discount(type, p, q, priceCents) }.getOrNull() ?: return null
        val line = PurchaseMath.line(q, priceCents, discount)
        return roundHalfUp(line.finalCents / q)
    }
}
