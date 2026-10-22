package com.maubautista.maunedas.core.data

import android.content.Context
import androidx.paging.testing.asSnapshot
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.maubautista.maunedas.core.database.AppDatabase
import com.maubautista.maunedas.core.database.entity.BarcodeEntity
import com.maubautista.maunedas.core.database.entity.CategoryEntity
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
import com.maubautista.maunedas.core.pricing.SearchKey
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.time.Instant

/**
 * The data of `apps/api/test/catalog.test.ts` in Room: the same searches, filters and best prices as
 * `GET /v1/products` (03 §7), so Android and the web agree.
 */
@RunWith(RobolectricTestRunner::class)
class CatalogRepositoryTest {
    private val now = Instant.parse("2026-10-22T18:00:00Z").toEpochMilli()
    private val day = 86_400_000L
    private val db =
        Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext<Context>(), AppDatabase::class.java).allowMainThreadQueries().build()
    private val catalog = CatalogRepository(db, Clock { now })

    @After
    fun close() = db.close()

    private fun product(
        id: String,
        name: String,
        brand: String?,
        unit: String,
        category: String? = null,
        deletedAt: Long? = null,
    ) = ProductEntity(
        id = id, name = name, brand = brand, categoryId = category, displayUnit = unit,
        // As the server derives it (packages/shared registry).
        searchKey = SearchKey.of("$name ${brand.orEmpty()}"), createdAt = 1, updatedAt = 1, deletedAt = deletedAt,
    )

    private fun variant(
        id: String,
        product: String,
        label: String,
        measure: String = "volume",
        amount: Double = 1000.0,
        pack: Long = 1,
        deletedAt: Long? = null,
    ) = VariantEntity(
        id = id, productId = product, label = label, measure = measure, unitAmount = amount, packCount = pack, soldByWeight = 0,
        createdAt = 1, updatedAt = 1, deletedAt = deletedAt,
    )

    private fun purchase(
        id: String,
        store: String,
        at: Long,
    ) = PurchaseEntity(id = id, storeId = store, purchasedAt = at, currency = "MXN", discountCents = 0, source = "manual", status = "confirmed", createdAt = 1, updatedAt = 1)

    private fun item(
        id: String,
        purchase: String,
        variant: String,
        cents: Long,
    ) = PurchaseItemEntity(
        id = id, purchaseId = purchase, lineNo = 1, variantId = variant, quantity = 1.0, unitPriceCents = cents, grossCents = cents,
        discountCents = 0, finalCents = cents, createdAt = 1, updatedAt = 1,
    )

    @Before
    fun seed() =
        runTest {
            db.categories().upsertAll(
                listOf(
                    CategoryEntity(id = "refri", name = "Refrigerados", sortOrder = 2, createdAt = 1, updatedAt = 1),
                    CategoryEntity(id = "lacteos", parentId = "refri", name = "Lácteos", sortOrder = 1, createdAt = 1, updatedAt = 1),
                ),
            )
            db.stores().upsertAll(
                listOf(
                    StoreEntity(id = "costco", name = "Costco", kind = "both", defaultCheckIntervalMin = 480, createdAt = 1, updatedAt = 1),
                    StoreEntity(id = "walmart", name = "Walmart", kind = "both", defaultCheckIntervalMin = 480, createdAt = 1, updatedAt = 1),
                ),
            )
            db.products().upsertAll(
                listOf(
                    product("leche", "Leche Lala Entera", "Lala", "L", category = "lacteos"),
                    product("cafe", "Café Legal", "Legal", "kg"),
                    product("coca", "Coca-Cola 600ml", "Coca-Cola", "L"),
                    product("borrado", "Leche Vieja", null, "L", deletedAt = 5),
                ),
            )
            db.variants().upsertAll(
                listOf(
                    variant("l1", "leche", "1 L"),
                    variant("l6", "leche", "6 × 1 L", pack = 6),
                    variant("kilo", "cafe", "1 kg", measure = "mass"),
                    variant("sobres", "cafe", "10 sobres", measure = "count", amount = 10.0),
                    // Deleted: not counted, and its very cheap recent price does not compete.
                    variant("viejo", "cafe", "250 g", measure = "mass", amount = 250.0, deletedAt = 5),
                    variant("coca600", "coca", "600 ml", amount = 600.0),
                ),
            )
            db.tags().upsertAll(listOf(TagEntity(id = "basicos", name = "Básicos", createdAt = 1, updatedAt = 1)))
            db.productTags().upsertAll(listOf(ProductTagEntity(id = "pt", productId = "leche", tagId = "basicos", createdAt = 1, updatedAt = 1)))
            db.barcodes().upsertAll(
                listOf(
                    BarcodeEntity(id = "b1", variantId = "l1", code = "7501020515343", source = "manual", createdAt = 1, updatedAt = 1),
                    BarcodeEntity(id = "b6", variantId = "l6", code = "7501020515350", source = "manual", createdAt = 1, updatedAt = 1),
                ),
            )
            // 6 × 1 L at Costco $159.00 (2.65 ¢/ml) beats 1 L at Walmart $28.50 (2.85 ¢/ml).
            db.purchases().upsertAll(
                listOf(purchase("p1", "costco", now - day), purchase("p2", "walmart", now - 2 * day), purchase("old", "walmart", now - 100 * day), purchase("p3", "costco", now - day)),
            )
            db.purchaseItems().upsertAll(
                listOf(
                    item("i1", "p1", "l6", 15_900),
                    item("i2", "p2", "l1", 2_850),
                    // Cheaper but 100 days old: outside the 90-day window.
                    item("i3", "old", "l1", 1_000),
                    item("i4", "old", "l6", 5_000),
                    item("i5", "p3", "kilo", 30_000),
                    // Very cheap per piece, but "pz" does not fit the product's kg.
                    item("i6", "p3", "sobres", 100),
                    item("i7", "p3", "viejo", 1),
                ),
            )
            // The newest Walmart point of the 1 L is this shelf price ($27.00, 2.70 ¢/ml): still above Costco.
            db.priceObservations().upsertAll(
                listOf(
                    PriceObservationEntity(
                        id = "o1", variantId = "l1", storeId = "walmart", source = "shelf", priceCents = 2_700, observedAt = now - day / 2,
                        createdAt = 1, updatedAt = 1,
                    ),
                ),
            )
        }

    private suspend fun names(
        query: String = "",
        category: String? = null,
        tag: String? = null,
    ) = catalog.products(query, category, tag).asSnapshot().map { it.name }

    @Test
    fun searchesWithoutAccentsOrCasePartiallyEveryWord() =
        runTest {
            assertEquals(listOf("Café Legal"), names("cafe"))
            assertEquals(listOf("Leche Lala Entera"), names("LEC"))
            assertEquals(listOf("Leche Lala Entera"), names("leche lala"))
            assertEquals(emptyList<String>(), names("leche legal"))
            assertEquals(listOf("Coca-Cola 600ml"), names("600"))
        }

    @Test
    fun digitsAlsoSearchTheExactBarcode() =
        runTest {
            assertEquals(listOf("Leche Lala Entera"), names("7501020515350"))
            assertEquals(listOf("Leche Lala Entera"), names(" 7501020515343 "))
        }

    @Test
    fun aCategoryIncludesItsSubcategoriesAndTagsFilter() =
        runTest {
            assertEquals(listOf("Leche Lala Entera"), names(category = "refri"))
            assertEquals(listOf("Leche Lala Entera"), names(category = "lacteos"))
            assertEquals(listOf("Leche Lala Entera"), names(tag = "basicos"))
            assertEquals(emptyList<String>(), names(query = "cafe", tag = "basicos"))
        }

    @Test
    fun excludesDeletedProductsAndCountsLiveVariants() =
        runTest {
            val items = catalog.products("", null, null).asSnapshot()
            assertEquals(listOf("Café Legal", "Coca-Cola 600ml", "Leche Lala Entera"), items.map { it.name })
            assertEquals(2, items.first { it.name == "Café Legal" }.variants)
            assertEquals(true, catalog.hasProducts().first())
        }

    @Test
    fun theBestPriceIsTheNewestPointPerVariantAndStoreInNinetyDaysOfACompatibleMeasure() =
        runTest {
            val items = catalog.products("", null, null).asSnapshot().associateBy { it.id }
            assertEquals(BestPrice("6 × 1 L", 2_650, DisplayUnit.L, "Costco", "purchase", now - day), items.getValue("leche").best)
            assertEquals(BestPrice("1 kg", 30_000, DisplayUnit.KG, "Costco", "purchase", now - day), items.getValue("cafe").best)
            assertNull(items.getValue("coca").best)
        }

    @Test
    fun categoriesAreATreeAndTagsAList() =
        runTest {
            assertEquals(listOf(CategoryNode("refri", "Refrigerados", 0), CategoryNode("lacteos", "Lácteos", 1)), catalog.categories().first())
            assertEquals(listOf(TagItem("basicos", "Básicos")), catalog.tags().first())
        }

    @Test
    fun theTreeKeepsSiblingOrderAndShowsOrphansAndCyclesAtTheTop() {
        fun cat(
            id: String,
            parent: String?,
            order: Long = 1,
        ) = CategoryEntity(id = id, parentId = parent, name = id, sortOrder = order, createdAt = 1, updatedAt = 1)
        // In query order (sort_order, name): b1 before b2 under b.
        val tree = categoryTree(listOf(cat("a", null), cat("b1", "b"), cat("b", null, 2), cat("b2", "b", 2), cat("orphan", "gone"), cat("x", "y"), cat("y", "x")))
        assertEquals(
            listOf("a" to 0, "b" to 0, "b1" to 1, "b2" to 1, "orphan" to 0, "x" to 0, "y" to 1),
            tree.map { it.id to it.depth },
        )
    }
}
