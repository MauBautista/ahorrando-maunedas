package com.maubautista.maunedas.core.data

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.maubautista.maunedas.core.database.AppDatabase
import com.maubautista.maunedas.core.database.entity.BarcodeEntity
import com.maubautista.maunedas.core.database.entity.CategoryEntity
import com.maubautista.maunedas.core.database.entity.ImageEntity
import com.maubautista.maunedas.core.database.entity.PriceObservationEntity
import com.maubautista.maunedas.core.database.entity.ProductEntity
import com.maubautista.maunedas.core.database.entity.ProductTagEntity
import com.maubautista.maunedas.core.database.entity.PurchaseEntity
import com.maubautista.maunedas.core.database.entity.PurchaseItemEntity
import com.maubautista.maunedas.core.database.entity.StoreEntity
import com.maubautista.maunedas.core.database.entity.TagEntity
import com.maubautista.maunedas.core.database.entity.VariantEntity
import com.maubautista.maunedas.core.model.Clock
import com.maubautista.maunedas.core.model.DisplayUnit
import com.maubautista.maunedas.core.network.ApiConfig
import java.time.Instant
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * The comparator data of `apps/api/test/prices.test.ts` and the latest prices of `catalog.test.ts`, in Room:
 * the product page must show what `GET /v1/products/:id` and `/compare` (03 §7) give the web.
 */
@RunWith(RobolectricTestRunner::class)
class ProductPageRepositoryTest {
    private val now = Instant.parse("2026-10-22T18:00:00Z").toEpochMilli()
    private val day = 86_400_000L
    private val db =
        Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext<Context>(), AppDatabase::class.java).allowMainThreadQueries().build()
    private val pages = ProductPageRepository(db, Clock { now }, ProductPhotos(ApplicationProvider.getApplicationContext(), db, ApiConfig("https://api.test")))

    @After
    fun close() = db.close()

    private fun at(days: Long) = now - days * day

    private fun variant(
        id: String,
        product: String,
        label: String,
        measure: String = "volume",
        amount: Double = 1000.0,
        pack: Long = 1,
        soldByWeight: Int = 0,
    ) = VariantEntity(
        id = id, productId = product, label = label, measure = measure, unitAmount = amount, packCount = pack, soldByWeight = soldByWeight,
        createdAt = 1, updatedAt = 1,
    )

    private fun shelf(
        id: String,
        variant: String,
        store: String,
        cents: Long,
        observedAt: Long,
    ) = PriceObservationEntity(id = id, variantId = variant, storeId = store, source = "shelf", priceCents = cents, observedAt = observedAt, createdAt = 1, updatedAt = 1)

    @Before
    fun seed() =
        runTest {
            db.stores().upsertAll(
                listOf(
                    StoreEntity(id = "costco", name = "Costco", kind = "both", defaultCheckIntervalMin = 480, createdAt = 1, updatedAt = 1),
                    StoreEntity(id = "walmart", name = "Walmart", kind = "both", defaultCheckIntervalMin = 480, createdAt = 1, updatedAt = 1),
                ),
            )
            db.categories().upsertAll(
                listOf(
                    CategoryEntity(id = "refri", name = "Refrigerados", sortOrder = 1, createdAt = 1, updatedAt = 1),
                    CategoryEntity(id = "lacteos", parentId = "refri", name = "Lácteos", sortOrder = 1, createdAt = 1, updatedAt = 1),
                ),
            )
            db.products().upsertAll(
                listOf(ProductEntity(id = "leche", name = "Leche Lala Entera", brand = "Lala", categoryId = "lacteos", displayUnit = "L", searchKey = "leche lala entera lala", createdAt = 1, updatedAt = 1)),
            )
            db.variants().upsertAll(listOf(variant("l1", "leche", "1 L"), variant("l6", "leche", "6 × 1 L", pack = 6), variant("pz", "leche", "100 vasos", measure = "count", amount = 100.0)))
            db.tags().upsertAll(listOf(TagEntity(id = "t", name = "Básicos", createdAt = 1, updatedAt = 1)))
            db.productTags().upsertAll(listOf(ProductTagEntity(id = "pt", productId = "leche", tagId = "t", createdAt = 1, updatedAt = 1)))
            db.barcodes().upsertAll(
                listOf(
                    BarcodeEntity(id = "b6", variantId = "l6", code = "7501020515350", source = "manual", createdAt = 1, updatedAt = 1),
                    BarcodeEntity(id = "b1", variantId = "l1", code = "7501020515343", source = "manual", createdAt = 1, updatedAt = 1),
                ),
            )
            db.priceObservations().upsertAll(
                listOf(
                    // 1 L at Walmart: 3 points in 90 days ($26.00 min, $28.50 newest) and one older than 90 days.
                    shelf("o1", "l1", "walmart", 2_600, at(40)),
                    shelf("o2", "l1", "walmart", 3_000, at(20)),
                    shelf("o3", "l1", "walmart", 2_850, at(2)),
                    shelf("o4", "l1", "walmart", 1_000, at(120)),
                    // 6 × 1 L at Costco: newest $159.00 (26.50 per L) beats every newest 1 L price.
                    shelf("o5", "l6", "costco", 15_000, at(30)),
                    shelf("o6", "l6", "costco", 15_900, at(1)),
                    // Another measure: 1 ¢ per piece never competes with liters.
                    shelf("o7", "pz", "costco", 100, at(1)),
                ),
            )
        }

    @Test
    fun theComparatorMatchesTheApi() =
        runTest {
            val rows = pages.page("leche").first()!!.comparison
            fun row(r: PageComparison) = listOf(r.variantId, r.storeId, r.unit, r.last.displayCents, r.last.observedAt, r.last.source, r.minCents, r.minAt, r.avgCents, r.n)
            assertEquals(
                listOf(
                    listOf("l6", "costco", DisplayUnit.L, 2_650L, at(1), "shelf", 2_500L, at(30), 2_575L, 2),
                    listOf("l1", "walmart", DisplayUnit.L, 2_850L, at(2), "shelf", 2_600L, at(40), 2_817L, 3),
                    listOf("pz", "costco", DisplayUnit.PZ, 1L, at(1), "shelf", 1L, at(1), 1L, 1),
                ),
                rows.map(::row),
            )
            assertEquals(listOf(true, false, false), rows.map { it.best })
            assertEquals(listOf(true, true, false), rows.map { it.comparable })
            assertEquals(listOf("6 × 1 L", "1 L", "100 vasos"), rows.map { it.variantLabel })
        }

    @Test
    fun variantsCarryContentCodesAndTheLatestPricePerStoreAndSource() =
        runTest {
            db.purchases().upsertAll(
                listOf(PurchaseEntity(id = "p", storeId = "walmart", purchasedAt = at(3), currency = "MXN", discountCents = 0, source = "manual", status = "confirmed", createdAt = 1, updatedAt = 1)),
            )
            db.purchaseItems().upsertAll(
                listOf(
                    PurchaseItemEntity(
                        id = "i", purchaseId = "p", lineNo = 1, variantId = "l1", quantity = 1.0, unitPriceCents = 2_900, grossCents = 2_900, discountCents = 0,
                        finalCents = 2_900, createdAt = 1, updatedAt = 1,
                    ),
                ),
            )
            val page = pages.page("leche").first()!!
            assertEquals("Refrigerados › Lácteos" to listOf("Básicos"), page.categoryPath to page.tags)
            // Variants by label, as GET /v1/products/:id.
            assertEquals(listOf("1 L", "100 vasos", "6 × 1 L"), page.variants.map { it.label })
            val l1 = page.variants.first { it.id == "l1" }
            assertEquals("1 L" to listOf("7501020515343"), l1.content to l1.codes)
            // Newest per (store, source), newest first; the shelf price ignores the 120-day-old one.
            assertEquals(
                listOf(PagePrice("walmart", "Walmart", "shelf", 2_850, 2_850, DisplayUnit.L, at(2)), PagePrice("walmart", "Walmart", "purchase", 2_900, 2_900, DisplayUnit.L, at(3))),
                l1.latest,
            )
            assertEquals("100 pz" to DisplayUnit.PZ, page.variants.first { it.id == "pz" }.let { it.content to it.latest.single().unit })
        }

    @Test
    fun theWindowIsNinetyDays() =
        runTest {
            // The 120-day-old $10.00 would be the minimum of 1 L at Walmart.
            assertEquals(2_600L, pages.page("leche").first()!!.comparison.first { it.variantId == "l1" }.minCents)
        }

    @Test
    fun thePageHasTheProductsPhoto() =
        runTest {
            assertNull(pages.page("leche").first()!!.photo)
            db.images().upsertAll(listOf(ImageEntity(id = "img", ownerType = "product", ownerId = "leche", role = "catalog", source = "user", originalKey = "images/img/original.jpg", createdAt = 1, updatedAt = 1)))
            db.products().upsertAll(listOf(db.products().byId("leche")!!.copy(primaryImageId = "img")))
            assertEquals("https://api.test/v1/images/img/blobs/original.jpg", pages.page("leche").first()!!.photo)
        }

    @Test
    fun aDeletedProductHasNoPage() =
        runTest {
            db.products().upsertAll(listOf(db.products().byId("leche")!!.copy(deletedAt = 9)))
            assertNull(pages.page("leche").first())
            assertNull(pages.page("nope").first())
        }
}
