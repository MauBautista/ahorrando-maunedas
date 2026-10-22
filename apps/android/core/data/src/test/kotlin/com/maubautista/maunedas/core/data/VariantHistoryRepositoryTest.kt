package com.maubautista.maunedas.core.data

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.maubautista.maunedas.core.database.AppDatabase
import com.maubautista.maunedas.core.database.entity.PriceObservationEntity
import com.maubautista.maunedas.core.database.entity.ProductEntity
import com.maubautista.maunedas.core.database.entity.PurchaseEntity
import com.maubautista.maunedas.core.database.entity.PurchaseItemEntity
import com.maubautista.maunedas.core.database.entity.StoreEntity
import com.maubautista.maunedas.core.database.entity.VariantEntity
import com.maubautista.maunedas.core.model.Clock
import com.maubautista.maunedas.core.model.DisplayUnit
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.time.Instant

/** The data of the history tests in `apps/api/test/prices.test.ts`: Room must give what the API gives. */
@RunWith(RobolectricTestRunner::class)
class VariantHistoryRepositoryTest {
    private val now = Instant.parse("2026-10-22T18:00:00Z").toEpochMilli()
    private val day = 86_400_000L
    private val db =
        Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext<Context>(), AppDatabase::class.java).allowMainThreadQueries().build()
    private val history = VariantHistoryRepository(db, Clock { now })

    @After
    fun close() = db.close()

    private fun at(days: Long) = now - days * day

    private fun purchase(
        id: String,
        daysAgo: Long,
        status: String = "confirmed",
        discount: Long = 0,
    ) = PurchaseEntity(id = id, storeId = "walmart", purchasedAt = at(daysAgo), currency = "MXN", discountCents = discount, source = "manual", status = status, createdAt = 1, updatedAt = 1)

    private fun item(
        id: String,
        purchase: String,
        variant: String?,
        unit: Long = 2_850,
        quantity: Double = 1.0,
        gross: Long = unit,
        discount: Long = 0,
        lineNo: Long = 1,
    ) = PurchaseItemEntity(
        id = id, purchaseId = purchase, lineNo = lineNo, variantId = variant, quantity = quantity, unitPriceCents = unit, grossCents = gross,
        discountCents = discount, finalCents = gross - discount, createdAt = 1, updatedAt = 1,
    )

    @Before
    fun seed() =
        runTest {
            db.stores().upsertAll(
                listOf(
                    StoreEntity(id = "walmart", name = "Walmart", kind = "both", defaultCheckIntervalMin = 480, createdAt = 1, updatedAt = 1),
                    StoreEntity(id = "amazon", name = "Amazon", kind = "online", defaultCheckIntervalMin = 480, createdAt = 1, updatedAt = 1),
                ),
            )
            db.products().upsertAll(
                listOf(
                    ProductEntity(id = "leche", name = "Leche Lala Entera", displayUnit = "L", searchKey = "leche lala entera", createdAt = 1, updatedAt = 1),
                    ProductEntity(id = "cafe", name = "Café", displayUnit = "kg", searchKey = "cafe", createdAt = 1, updatedAt = 1),
                ),
            )
            db.variants().upsertAll(
                listOf(
                    VariantEntity(id = "l1", productId = "leche", label = "1 L", measure = "volume", unitAmount = 1000.0, packCount = 1, soldByWeight = 0, createdAt = 1, updatedAt = 1),
                    VariantEntity(id = "sobres", productId = "cafe", label = "10 sobres", measure = "count", unitAmount = 10.0, packCount = 1, soldByWeight = 0, createdAt = 1, updatedAt = 1),
                ),
            )
            db.purchases().upsertAll(
                listOf(purchase("old", 400), purchase("recent", 300, discount = 500), purchase("draft", 10, status = "draft"), purchase("promo", 5), purchase("coffee", 5)),
            )
            db.purchaseItems().upsertAll(
                listOf(
                    item("i1", "old", "l1"),
                    // $28.50 + $21.50 with a $5.00 coupon: this line paid 2850 × (1 − 500/5000) = 2565.
                    item("i2", "recent", "l1"),
                    item("i3", "recent", null, unit = 2_150, lineNo = 2),
                    item("i4", "draft", "l1", unit = 100),
                    item("i5", "promo", "l1", quantity = 2.0, gross = 5_700, discount = 2_850),
                    item("i6", "coffee", "sobres", unit = 5_000),
                ),
            )
            db.priceObservations().upsertAll(
                listOf(
                    PriceObservationEntity(
                        id = "o1", variantId = "l1", storeId = "walmart", source = "shelf", priceCents = 2_700, promoText = "2x$50", observedAt = at(3),
                        createdAt = 1, updatedAt = 1,
                    ),
                    PriceObservationEntity(
                        id = "o2", variantId = "l1", storeId = "amazon", listingId = "listing", source = "web", priceCents = 2_600, observedAt = at(2),
                        createdAt = 1, updatedAt = 1,
                    ),
                ),
            )
        }

    private suspend fun points(filter: HistoryFilter = HistoryFilter()) = history.history("l1", DisplayUnit.L, filter).first().points

    @Test
    fun aYearByDefaultOldestFirstConfirmedOnlyWithTheCouponProrated() =
        runTest {
            val h = history.history("l1", DisplayUnit.L, HistoryFilter()).first()
            assertEquals(DisplayUnit.L, h.unit)
            assertEquals(
                listOf(
                    listOf("purchase", 2_850L, 2_565L, 2_565L, true),
                    listOf("purchase", 2_850L, 1_425L, 1_425L, true),
                    listOf("shelf", 2_700L, 2_700L, 2_700L, true),
                    listOf("web", 2_600L, 2_600L, 2_600L, false),
                ),
                h.points.map { listOf(it.source, it.listUnitCents, it.effectiveUnitCents, it.displayCents, it.hasPromo) },
            )
            assertEquals(listOf(HistoryStore("amazon", "Amazon"), HistoryStore("walmart", "Walmart")), h.stores)
        }

    @Test
    fun filtersByPeriodSourcesAndStore() =
        runTest {
            assertEquals(5, points(HistoryFilter(period = HistoryPeriod.ALL)).size)
            assertEquals(listOf("purchase", "shelf", "web"), points(HistoryFilter(period = HistoryPeriod.THREE_MONTHS)).map { it.source })
            assertEquals(listOf("shelf", "web"), points(HistoryFilter(sources = setOf("shelf", "web"))).map { it.source })
            assertEquals(listOf("purchase", "purchase", "shelf"), points(HistoryFilter(storeId = "walmart")).map { it.source })
            assertEquals(emptyList<HistoryPoint>(), points(HistoryFilter(sources = emptySet())))
        }

    @Test
    fun aVariantOfAnotherMeasureShowsInItsDefaultUnit() =
        runTest {
            val h = history.history("sobres", DisplayUnit.KG, HistoryFilter()).first()
            assertEquals(DisplayUnit.PZ to 500L, h.unit to h.points.single().displayCents)
        }
}
