package com.maubautista.maunedas.core.pricing

import kotlin.math.abs

/** A line's money: `final = gross − discount` always (RF-COM-02, `PurchaseItemRowSchema`). */
data class LineAmounts(
    val grossCents: Long,
    val discountCents: Long,
) {
    val finalCents: Long get() = grossCents - discountCents
}

/** The footer of S-04: Σ lines, ticket discounts, the computed total and how far it is from the ticket's. */
data class PurchaseTotals(
    val linesCents: Long,
    val ticketDiscountCents: Long,
    val computedCents: Long,
    /** Ticket total − computed total; null when no ticket total was typed. */
    val differenceCents: Long?,
) {
    /** RF-COM-06: more than $1.00 apart asks to confirm. */
    val mismatch: Boolean get() = differenceCents != null && abs(differenceCents) > PurchaseMath.TOLERANCE_CENTS
}

/** Purchase arithmetic shared by the editor and its tests (05 §5 S-04, S-05). */
object PurchaseMath {
    const val TOLERANCE_CENTS = 100L

    /** RF-COM-04: 0.845 kg × $32.90 = $27.80 (half-up, as `bruto` in 09 §6.1). */
    fun gross(
        quantity: Double,
        unitPriceCents: Long,
    ): Long = roundHalfUp(quantity * unitPriceCents)

    /**
     * The line with its promotion: [promoDiscountCents] (already from [Promotions.discount] or typed by hand) is kept
     * within [0, gross]; a promotion that does not affect the price (MSI) discounts nothing.
     */
    fun line(
        quantity: Double,
        unitPriceCents: Long,
        promoDiscountCents: Long?,
        affectsPrice: Boolean = true,
    ): LineAmounts {
        val gross = gross(quantity, unitPriceCents)
        val discount = if (promoDiscountCents == null || !affectsPrice) 0 else promoDiscountCents.coerceIn(0, gross)
        return LineAmounts(gross, discount)
    }

    /** Σ final − ticket discounts, never below zero (as `v_price_points` and the list totals). */
    fun totals(
        lineFinals: List<Long>,
        ticketDiscounts: List<Long>,
        ticketTotalCents: Long?,
    ): PurchaseTotals {
        val lines = lineFinals.sum()
        val discounts = ticketDiscounts.sum()
        val computed = maxOf(0, lines - discounts)
        return PurchaseTotals(lines, discounts, computed, ticketTotalCents?.let { it - computed })
    }
}
