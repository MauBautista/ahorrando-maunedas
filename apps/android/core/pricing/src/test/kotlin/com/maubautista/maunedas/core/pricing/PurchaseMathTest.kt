package com.maubautista.maunedas.core.pricing

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PurchaseMathTest {
    @Test
    fun rfCom04BulkIsRoundedHalfUp() {
        assertEquals(2_780L, PurchaseMath.gross(0.845, 3_290))
        // 2.5 cents round up, never to even.
        assertEquals(3L, PurchaseMath.gross(0.5, 5))
    }

    @Test
    fun aLineKeepsFinalEqualToGrossMinusDiscount() {
        // 2x1 of $89.00 with 2 pieces.
        val twoForOne = Promotions.discount(PromoType.NXM, PromoParams(n = 2.0, m = 1.0), 2.0, 8_900)
        assertEquals(LineAmounts(17_800, 8_900), PurchaseMath.line(2.0, 8_900, twoForOne))
        assertEquals(8_900L, PurchaseMath.line(2.0, 8_900, twoForOne).finalCents)
        // A hand-typed discount above the gross leaves $0, never negative.
        assertEquals(0L, PurchaseMath.line(1.0, 1_000, 5_000).finalCents)
        // MSI does not change the price.
        assertEquals(LineAmounts(12_000, 0), PurchaseMath.line(1.0, 12_000, 3_000, affectsPrice = false))
        assertEquals(LineAmounts(500, 0), PurchaseMath.line(1.0, 500, null))
    }

    @Test
    fun rfCom06TheDifferenceCountsOnlyAboveOnePeso() {
        val t = PurchaseMath.totals(listOf(10_000, 5_050), listOf(500), 14_450)
        assertEquals(PurchaseTotals(15_050, 500, 14_550, -100), t)
        assertFalse(t.mismatch)
        assertTrue(PurchaseMath.totals(listOf(10_000), emptyList(), 10_101).mismatch)
        assertNull(PurchaseMath.totals(listOf(10_000), emptyList(), null).differenceCents)
        // Ticket discounts above the lines leave a $0 total.
        assertEquals(0L, PurchaseMath.totals(listOf(300), listOf(500), null).computedCents)
    }
}
