package com.maubautista.maunedas.core.pricing

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ShelfPricesTest {
    @Test
    fun aPromotionGivesThePricePerUnitAtTheQuantityThatTriggersIt() {
        // 2x1 of $89.00: two for $89.00, $44.50 each.
        assertEquals(4_450L, ShelfPrices.effective(PromoType.NXM, PromoParams(n = 2.0, m = 1.0), 8_900))
        // 3x2 of $25.00: $50.00 for three, $16.67 each (half-up).
        assertEquals(1_667L, ShelfPrices.effective(PromoType.NXM, PromoParams(n = 3.0, m = 2.0), 2_500))
        // Second at 50 % of $40.00: $60.00 for two.
        assertEquals(3_000L, ShelfPrices.effective(PromoType.NTH_UNIT_DISCOUNT, PromoParams(nth = 2.0, percent = 50.0), 4_000))
        assertEquals(10_200L, ShelfPrices.effective(PromoType.PERCENT, PromoParams(percent = 15.0), 12_000))
        // A price cut from the shelf price to $29.90.
        assertEquals(2_990L, ShelfPrices.effective(PromoType.PRICE_CUT, PromoParams(toCents = 2_990.0), 3_500))
        assertEquals(2_700L, ShelfPrices.effective(PromoType.MEMBER_PRICE, PromoParams(memberCents = 2_700.0), 2_990))
        assertEquals(2_500L, ShelfPrices.effective(PromoType.COUPON, PromoParams(amountCents = 500.0), 3_000))
    }

    @Test
    fun msiAndIncompletePromotionsChangeNothing() {
        assertNull(ShelfPrices.effective(PromoType.MSI, PromoParams(months = 12.0), 899_900))
        assertNull(ShelfPrices.effective(PromoType.NXM, PromoParams(n = 2.0), 8_900))
        // A coupon larger than the price leaves $0, never negative.
        assertEquals(0L, ShelfPrices.effective(PromoType.COUPON, PromoParams(amountCents = 9_000.0), 3_000))
        assertEquals(1.0, ShelfPrices.qualifyingQuantity(PromoType.NXM, PromoParams()), 0.0)
    }
}
