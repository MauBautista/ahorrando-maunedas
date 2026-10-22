package com.maubautista.maunedas.core.data

import android.content.Context
import androidx.paging.testing.asSnapshot
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.maubautista.maunedas.core.database.AppDatabase
import com.maubautista.maunedas.core.database.entity.PurchaseEntity
import com.maubautista.maunedas.core.database.entity.PurchaseItemEntity
import com.maubautista.maunedas.core.database.entity.StoreEntity
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** S-03 over Room: the same order and filters as `GET /v1/purchases` (03 §7). */
@RunWith(RobolectricTestRunner::class)
class PurchasePageTest {
    private val db =
        Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext<Context>(), AppDatabase::class.java).allowMainThreadQueries().build()
    private val purchases = PurchaseRepository(db)

    @After
    fun close() = db.close()

    private fun purchase(
        id: String,
        store: String,
        at: Long,
        status: String = "confirmed",
        total: Long? = 100,
        deletedAt: Long? = null,
    ) = PurchaseEntity(
        id = id, storeId = store, purchasedAt = at, currency = "MXN", discountCents = 0, totalCents = total, source = "manual", status = status,
        createdAt = 1, updatedAt = 1, deletedAt = deletedAt,
    )

    @Before
    fun seed() =
        runTest {
            db.stores().upsertAll(
                listOf("soriana" to "Soriana", "costco" to "Costco", "oxxo" to "OXXO").map { (id, name) ->
                    StoreEntity(id = id, name = name, kind = "physical", defaultCheckIntervalMin = 480, createdAt = 1, updatedAt = 1)
                },
            )
            db.purchases().upsertAll(
                listOf(
                    purchase("a", "soriana", 1_000),
                    purchase("b", "costco", 2_000, status = "draft", total = null),
                    purchase("c", "soriana", 2_000),
                    purchase("d", "costco", 3_000),
                    // Deleted: not listed, and its store is not a filter option.
                    purchase("e", "oxxo", 2_500, deletedAt = 9),
                ),
            )
            db.purchaseItems().upsertAll(
                listOf(
                    PurchaseItemEntity(
                        id = "i", purchaseId = "b", lineNo = 1, quantity = 1.0, unitPriceCents = 4_200, grossCents = 4_200, discountCents = 0, finalCents = 4_200,
                        createdAt = 1, updatedAt = 1,
                    ),
                ),
            )
        }

    private suspend fun ids(filter: PurchaseFilter = PurchaseFilter()) = purchases.page(filter).asSnapshot().map { it.id }

    @Test
    fun newestFirstWithTheIdBreakingTies() =
        runTest {
            assertEquals(listOf("d", "c", "b", "a"), ids())
            // Without a ticket total, the lines count (as in Inicio).
            val draft = purchases.page(PurchaseFilter()).asSnapshot().first { it.id == "b" }
            assertEquals(Triple(4_200L, 1, true), Triple(draft.totalCents, draft.lineCount, draft.draft))
        }

    @Test
    fun filtersByStoreStatusAndAnInclusiveRange() =
        runTest {
            assertEquals(listOf("c", "a"), ids(PurchaseFilter(storeId = "soriana")))
            assertEquals(listOf("b"), ids(PurchaseFilter(status = "draft")))
            assertEquals(listOf("d", "c", "a"), ids(PurchaseFilter(status = "confirmed")))
            assertEquals(listOf("c", "b"), ids(PurchaseFilter(from = 2_000, to = 2_999)))
            assertEquals(listOf("d", "c", "b"), ids(PurchaseFilter(from = 2_000, to = 3_000)))
            assertEquals(listOf("c"), ids(PurchaseFilter(storeId = "soriana", status = "confirmed", from = 1_001)))
        }

    @Test
    fun storeOptionsAreThoseWithLivePurchases() =
        runTest {
            assertEquals(listOf(StoreOption("costco", "Costco"), StoreOption("soriana", "Soriana")), purchases.storesWithPurchases().first())
            assertEquals(true, purchases.hasPurchases().first())
        }
}
