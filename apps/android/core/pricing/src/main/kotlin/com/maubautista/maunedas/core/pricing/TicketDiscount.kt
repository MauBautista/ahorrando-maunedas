package com.maubautista.maunedas.core.pricing

/** Ticket-level discount prorating (RF-COM-05), same operations as `v_price_points` and `ticketDiscount.ts`. */
object TicketDiscount {
    /** paid = final × (1 − min(discount, Σ final) / Σ final), or final when Σ final = 0. Not rounded. */
    fun prorate(
        finalCents: List<Long>,
        discountCents: Long,
    ): List<Double> {
        require(discountCents >= 0) { "discount_cents debe ser un entero de centavos ≥ 0" }
        require(finalCents.all { it >= 0 }) { "final_cents debe ser un entero de centavos ≥ 0" }
        val total = finalCents.sum()
        val factor = if (total > 0) 1 - minOf(discountCents, total).toDouble() / total.toDouble() else 1.0
        return finalCents.map { it * factor }
    }

    /** Effective price per unit of quantity, as `v_price_points.effective_unit_cents`. */
    fun effectiveUnitCents(
        paidCents: Double,
        quantity: Double,
    ): Long {
        require(quantity > 0) { "La cantidad debe ser mayor que 0" }
        return roundHalfUp(paidCents / quantity)
    }
}
