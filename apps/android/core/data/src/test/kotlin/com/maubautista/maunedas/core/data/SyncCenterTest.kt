package com.maubautista.maunedas.core.data

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.maubautista.maunedas.core.database.AppDatabase
import com.maubautista.maunedas.core.database.entity.AlertRuleEntity
import com.maubautista.maunedas.core.database.entity.BarcodeEntity
import com.maubautista.maunedas.core.database.entity.ImageEntity
import com.maubautista.maunedas.core.database.entity.OutboxEntry
import com.maubautista.maunedas.core.database.entity.PendingUploadEntity
import com.maubautista.maunedas.core.database.entity.PriceObservationEntity
import com.maubautista.maunedas.core.database.entity.ProductEntity
import com.maubautista.maunedas.core.database.entity.PurchaseItemEntity
import com.maubautista.maunedas.core.database.entity.SyncIssueEntity
import com.maubautista.maunedas.core.database.entity.VariantEntity
import com.maubautista.maunedas.core.model.Clock
import com.maubautista.maunedas.core.sync.LocalWriter
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File

@RunWith(RobolectricTestRunner::class)
class SyncCenterTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val db = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java).allowMainThreadQueries().build()
    private val clock = Clock { 5_000L }
    private val center = SyncCenter(context, db, LocalWriter(db, clock, { "me" }, { }), { "me" }, clock)

    @After
    fun close() = db.close()

    private suspend fun catalog() {
        db.products().upsertAll(
            listOf(
                ProductEntity(id = "p1", name = "Leche Lala", displayUnit = "L", searchKey = "leche lala", createdAt = 1, updatedAt = 1),
                ProductEntity(id = "p2", name = "Leche Alpura", displayUnit = "L", searchKey = "leche alpura", createdAt = 1, updatedAt = 1),
            ),
        )
        db.variants().upsertAll(
            listOf("mine" to "p1", "theirs" to "p2").map { (id, p) ->
                VariantEntity(id = id, productId = p, label = "1 L", measure = "volume", unitAmount = 1000.0, packCount = 1, soldByWeight = 0, createdAt = 1, updatedAt = 1)
            },
        )
        db.barcodes().upsertAll(listOf(BarcodeEntity(id = "b", variantId = "mine", code = "7501020515343", source = "manual", createdAt = 1, updatedAt = 1)))
    }

    private fun issue(
        table: String,
        row: String,
        reason: String,
        details: String?,
        at: Long = 1,
    ) = SyncIssueEntity(tableName = table, rowId = row, reason = reason, detailsJson = details, createdAt = at)

    @Test
    fun pendingChangesAreCountedPerTable() =
        runTest {
            db.outbox().enqueueAll(
                listOf("purchases" to "a", "purchase_items" to "b", "purchase_items" to "c").map { (t, r) -> OutboxEntry(tableName = t, rowId = r, enqueuedAt = 1) },
            )
            assertEquals(listOf(PendingTable("purchase_items", 2), PendingTable("purchases", 1)), center.pendingByTable().first())
        }

    @Test
    fun refusalsCarryTheirNameAndDetailReasonAndCanBeDismissed() =
        runTest {
            catalog()
            // The conflict handler wraps the details; push splits and uploads store them bare.
            db.syncIssues().add(issue("variants", "mine", "VALIDATION", """{"details":{"reason":"MEASURE_LOCKED"},"server_row":{}}""", at = 3))
            db.syncIssues().add(issue("products", "p2", "FORBIDDEN", """{"reason":"ADMIN_DELETE"}""", at = 2))
            db.syncIssues().add(issue("pending_uploads", "img/original.jpg", "LOCAL_FILE_MISSING", null, at = 1))
            db.syncIssues().add(issue("barcodes", "b", "BARCODE_TAKEN", """{"details":{"variant_id":"theirs"}}"""))
            val rejected = center.rejected().first()
            assertEquals(
                listOf(
                    listOf("variants", "VALIDATION", "MEASURE_LOCKED", "Leche Lala · 1 L"),
                    listOf("products", "FORBIDDEN", "ADMIN_DELETE", "Leche Alpura"),
                    listOf("pending_uploads", "LOCAL_FILE_MISSING", null, null),
                ),
                rejected.map { listOf(it.table, it.reason, it.detailReason, it.label) },
            )
            center.dismiss(rejected.first().id)
            assertEquals(2, center.rejected().first().size)
        }

    @Test
    fun usingTheirVariantMovesWhatIsMineAndDeletesMyCode() =
        runTest {
            catalog()
            db.purchaseItems().upsertAll(
                listOf(
                    PurchaseItemEntity(
                        id = "i", purchaseId = "pu", lineNo = 1, variantId = "mine", quantity = 1.0, unitPriceCents = 100, grossCents = 100, discountCents = 0,
                        finalCents = 100, createdAt = 1, updatedAt = 1,
                    ),
                ),
            )
            db.priceObservations().upsertAll(
                listOf("shelf", "web").map { s ->
                    PriceObservationEntity(id = "o-$s", variantId = "mine", storeId = "s", source = s, priceCents = 100, observedAt = 1, createdAt = 1, updatedAt = 1)
                },
            )
            db.alertRules().upsertAll(
                listOf("me", "other").map { u ->
                    AlertRuleEntity(id = "r-$u", userId = u, variantId = "mine", type = "below_price", scope = "any", cooldownHours = 24, active = 1, createdAt = 1, updatedAt = 1)
                },
            )
            db.images().upsertAll(listOf(ImageEntity(id = "img", ownerType = "variant", ownerId = "mine", role = "catalog", source = "user", createdAt = 1, updatedAt = 1)))
            db.syncIssues().add(issue("barcodes", "b", "BARCODE_TAKEN", """{"details":{"variant_id":"theirs"},"server_row":null}"""))
            val conflict = center.barcodeConflicts().first().single()
            assertEquals(BarcodeConflict(conflict.issueId, "b", "7501020515343", "mine", "Leche Lala · 1 L", "theirs", "Leche Alpura · 1 L"), conflict)

            center.useTheirVariant(conflict)

            assertEquals("theirs", db.purchaseItems().byId("i")!!.variantId)
            assertEquals("theirs" to "mine", db.priceObservations().byId("o-shelf")!!.variantId to db.priceObservations().byId("o-web")!!.variantId)
            assertEquals("theirs" to "mine", db.alertRules().byId("r-me")!!.variantId to db.alertRules().byId("r-other")!!.variantId)
            assertEquals("theirs", db.images().byId("img")!!.ownerId)
            assertEquals(5_000L, db.barcodes().byId("b")!!.deletedAt)
            assertEquals(emptyList<BarcodeConflict>(), center.barcodeConflicts().first())
        }

    @Test
    fun keepingSeparateOnlyDeletesMyCode() =
        runTest {
            catalog()
            db.syncIssues().add(issue("barcodes", "b", "BARCODE_TAKEN", """{"details":{"variant_id":"theirs"}}"""))
            center.keepSeparate(center.barcodeConflicts().first().single())
            assertEquals(5_000L, db.barcodes().byId("b")!!.deletedAt)
            assertEquals(emptyList<BarcodeConflict>(), center.barcodeConflicts().first())
            assertEquals(listOf("barcodes"), db.outbox().nextBatch(10, Long.MAX_VALUE).map { it.tableName })
        }

    @Test
    fun freeingSpaceKeepsThePhotosStillToUpload() =
        runTest {
            val dir = File(context.filesDir, "images")
            val uploaded = File(dir, "a/original.jpg").apply { parentFile!!.mkdirs(); writeBytes(ByteArray(300)) }
            val waiting = File(dir, "b/original.jpg").apply { parentFile!!.mkdirs(); writeBytes(ByteArray(200)) }
            db.pendingUploads().enqueue(PendingUploadEntity(kind = "blob", imageId = "b", name = "original.jpg", localPath = waiting.path, createdAt = 1))
            assertEquals(500L, center.localPhotosBytes())
            assertEquals(300L, center.freeSpace())
            assertFalse(uploaded.exists())
            assertTrue(waiting.exists())
            assertEquals(200L, center.localPhotosBytes())
        }
}
