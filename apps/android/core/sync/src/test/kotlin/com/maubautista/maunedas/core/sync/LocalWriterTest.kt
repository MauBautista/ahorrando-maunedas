package com.maubautista.maunedas.core.sync

import com.maubautista.maunedas.core.database.entity.AlertRuleEntity
import com.maubautista.maunedas.core.database.entity.ImageEntity
import com.maubautista.maunedas.core.database.entity.ListingEntity
import com.maubautista.maunedas.core.database.entity.PromotionEntity
import com.maubautista.maunedas.core.database.entity.PurchaseEntity
import com.maubautista.maunedas.core.database.entity.PurchaseItemEntity
import com.maubautista.maunedas.core.database.entity.UserEntity
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class LocalWriterTest {
    private val env = TestEnv()
    private val db = env.db

    @After
    fun close() = env.close()

    private suspend fun queued() = db.outbox().nextBatch(1000, Long.MAX_VALUE).map { "${it.tableName}/${it.rowId}" }.sorted()

    @Test
    fun stampsEnqueuesAndAsksForASync() =
        runTest {
            env.writer.write(SyncTables.of("tags"), listOf(tag("t1")))
            val row = db.tags().byId("t1")!!
            assertEquals(env.clock.now, row.updatedAt)
            assertEquals(ME, row.updatedBy)
            assertEquals(listOf("tags/t1"), queued())
            assertEquals(env.clock.now, db.outbox().nextBatch(10, Long.MAX_VALUE).single().enqueuedAt)
            assertEquals(1, env.syncRequests)
        }

    @Test
    fun downTablesAreNotWrittenByTheClient() =
        runTest {
            val users = SyncTables.of<UserEntity>("users")
            assertThrows(IllegalArgumentException::class.java) {
                kotlinx.coroutines.runBlocking { env.writer.write(users, listOf(UserEntity("u", "u", "U", "member", 1, 1))) }
            }
        }

    @Test
    fun deletingAPurchaseTombstonesItsLinesPromotionsAndReceiptPages() =
        runTest {
            val p = PurchaseEntity(id = "p1", storeId = "s", purchasedAt = 1, currency = "MXN", discountCents = 0, source = "manual", status = "draft", createdAt = 1, updatedAt = 1)
            val other = p.copy(id = "p2")
            val item = { id: String, purchase: String ->
                PurchaseItemEntity(id = id, purchaseId = purchase, lineNo = 1, quantity = 1.0, unitPriceCents = 1, grossCents = 1, discountCents = 0, finalCents = 1, createdAt = 1, updatedAt = 1)
            }
            val promo = { id: String, purchase: String?, line: String? ->
                PromotionEntity(id = id, purchaseId = purchase, purchaseItemId = line, type = "coupon", discountCents = 1, affectsPrice = 1, createdAt = 1, updatedAt = 1)
            }
            val page = { id: String, owner: String, role: String ->
                ImageEntity(id = id, ownerType = "purchase", ownerId = owner, role = role, source = "user", createdAt = 1, updatedAt = 1)
            }
            db.purchases().upsertAll(listOf(p, other))
            db.purchaseItems().upsertAll(listOf(item("i1", "p1"), item("i2", "p1"), item("i9", "p2")))
            db.promotions().upsertAll(listOf(promo("pr1", "p1", null), promo("pr2", null, "i2"), promo("pr9", "p2", null)))
            db.images().upsertAll(listOf(page("im1", "p1", "receipt"), page("im9", "p2", "receipt")))

            env.clock.now += 5_000
            env.writer.delete(SyncTables.of("purchases"), listOf(p))

            for (id in listOf("i1", "i2")) assertEquals(id, env.clock.now, db.purchaseItems().byId(id)!!.deletedAt)
            for (id in listOf("pr1", "pr2")) assertNotNull(id, db.promotions().byId(id)!!.deletedAt)
            assertNotNull(db.images().byId("im1")!!.deletedAt)
            assertNull(db.purchaseItems().byId("i9")!!.deletedAt)
            assertNull(db.promotions().byId("pr9")!!.deletedAt)
            assertNull(db.images().byId("im9")!!.deletedAt)
            assertEquals(
                listOf("images/im1", "promotions/pr1", "promotions/pr2", "purchase_items/i1", "purchase_items/i2", "purchases/p1"),
                queued(),
            )
        }

    @Test
    fun deletingAProductTombstonesVariantsAndWhatHangsFromThemButKeepsHistory() =
        runTest {
            db.products().upsertAll(listOf(product("prod")))
            db.variants().upsertAll(listOf(variant("v1", "prod")))
            db.barcodes().upsertAll(listOf(barcode("b1", "v1")))
            db.listings().upsertAll(listOf(ListingEntity(id = "l1", variantId = "v1", storeId = "s", adapter = "amazon_mx", url = "https://a", active = 1, createdAt = 1, updatedAt = 1)))
            db.alertRules().upsertAll(listOf(AlertRuleEntity(id = "r1", userId = ME, variantId = "v1", type = "promo", scope = "listing", cooldownHours = 24, active = 1, createdAt = 1, updatedAt = 1)))
            db.purchaseItems().upsertAll(
                listOf(PurchaseItemEntity(id = "line", purchaseId = "p", lineNo = 1, variantId = "v1", quantity = 1.0, unitPriceCents = 1, grossCents = 1, discountCents = 0, finalCents = 1, createdAt = 1, updatedAt = 1)),
            )

            env.writer.delete(SyncTables.of("products"), listOf(db.products().byId("prod")!!))

            assertNotNull(db.variants().byId("v1")!!.deletedAt)
            assertNotNull(db.barcodes().byId("b1")!!.deletedAt)
            assertNotNull(db.listings().byId("l1")!!.deletedAt)
            assertNotNull(db.alertRules().byId("r1")!!.deletedAt)
            assertNull(db.purchaseItems().byId("line")!!.deletedAt)
            assertEquals(listOf("alert_rules/r1", "barcodes/b1", "listings/l1", "products/prod", "variants/v1"), queued())
        }
}
