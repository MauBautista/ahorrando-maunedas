package com.maubautista.maunedas.core.database

import com.maubautista.maunedas.core.database.dao.PurchaseSummaryRow
import com.maubautista.maunedas.core.database.entity.OutboxEntry
import com.maubautista.maunedas.core.database.entity.PendingUploadEntity
import com.maubautista.maunedas.core.database.entity.PurchaseEntity
import com.maubautista.maunedas.core.database.entity.PurchaseItemEntity
import com.maubautista.maunedas.core.database.entity.StoreBranchEntity
import com.maubautista.maunedas.core.database.entity.StoreEntity
import com.maubautista.maunedas.core.database.entity.SyncIssueEntity
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

internal fun purchase(
    id: String,
    at: Long,
    status: String = "confirmed",
    total: Long? = null,
    discount: Long = 0,
    store: String = "s1",
    branch: String? = null,
    deletedAt: Long? = null,
) = PurchaseEntity(
    id = id, storeId = store, branchId = branch, purchasedAt = at, currency = "MXN", discountCents = discount, totalCents = total,
    source = "manual", status = status, createdAt = 1, updatedAt = 1, deletedAt = deletedAt,
)

internal fun line(
    id: String,
    purchase: String,
    finalCents: Long,
    deletedAt: Long? = null,
) = PurchaseItemEntity(
    id = id, purchaseId = purchase, lineNo = 1, quantity = 1.0, unitPriceCents = finalCents, grossCents = finalCents, discountCents = 0,
    finalCents = finalCents, createdAt = 1, updatedAt = 1, deletedAt = deletedAt,
)

@RunWith(RobolectricTestRunner::class)
class PurchaseQueryDaoTest {
    private val db = inMemoryDb()
    private val queries = db.purchaseQueries()

    @After
    fun close() = db.close()

    private suspend fun stores() {
        db.stores().upsertAll(
            listOf(
                StoreEntity(id = "s1", name = "Soriana", kind = "physical", defaultCheckIntervalMin = 360, createdAt = 1, updatedAt = 1),
                // A store an admin deleted still names its old purchases.
                StoreEntity(id = "s2", name = "Chedraui", kind = "physical", defaultCheckIntervalMin = 360, createdAt = 1, updatedAt = 1, deletedAt = 5),
            ),
        )
        db.storeBranches().upsertAll(listOf(StoreBranchEntity(id = "b1", storeId = "s1", name = "Centro", createdAt = 1, updatedAt = 1)))
    }

    @Test
    fun recentPurchasesAreNewestFirstWithTheirTotal() =
        runTest {
            stores()
            db.purchases().upsertAll(
                listOf(
                    purchase("p1", at = 100, total = 10_000, branch = "b1"),
                    // No ticket total: live lines − ticket discount (the deleted line does not count).
                    purchase("p2", at = 300, status = "draft", discount = 500),
                    // A discount above the lines leaves $0, never a negative total.
                    purchase("p3", at = 200, discount = 300, store = "s2"),
                    purchase("p4", at = 400, deletedAt = 9),
                    // Its store has not arrived by sync yet.
                    purchase("p5", at = 200, total = 50, store = "missing"),
                ),
            )
            db.purchaseItems().upsertAll(
                listOf(line("i1", "p2", 3_000), line("i2", "p2", 2_000), line("i3", "p2", 999, deletedAt = 7), line("i4", "p3", 100), line("i5", "p4", 1)),
            )
            assertEquals(
                listOf(
                    PurchaseSummaryRow("p2", 300, "draft", "Soriana", null, 4_500, 2),
                    // Same time: the id breaks the tie.
                    PurchaseSummaryRow("p5", 200, "confirmed", null, null, 50, 0),
                    PurchaseSummaryRow("p3", 200, "confirmed", "Chedraui", null, 0, 1),
                    PurchaseSummaryRow("p1", 100, "confirmed", "Soriana", "Centro", 10_000, 0),
                ),
                queries.recent(10).first(),
            )
            assertEquals(listOf("p2", "p5"), queries.recent(2).first().map { it.id })
        }

    @Test
    fun theMonthSpendingCountsConfirmedPurchasesInsideTheSpan() =
        runTest {
            db.purchases().upsertAll(
                listOf(
                    purchase("from", at = 1_000, total = 100),
                    purchase("lines", at = 1_500, discount = 50),
                    purchase("until", at = 2_000, total = 10_000),
                    purchase("before", at = 999, total = 10_000),
                    purchase("draft", at = 1_200, status = "draft", total = 10_000),
                    purchase("deleted", at = 1_200, total = 10_000, deletedAt = 3),
                ),
            )
            db.purchaseItems().upsertAll(listOf(line("i1", "lines", 400), line("i2", "draft", 10_000)))
            assertEquals(100L + (400 - 50), queries.spent(from = 1_000, until = 2_000).first())
            assertEquals(0L, queries.spent(from = 5_000, until = 6_000).first())
        }

    @Test
    fun openDraftsAndTheSyncBacklogAreObserved() =
        runTest {
            db.purchases().upsertAll(
                listOf(purchase("d1", 1, status = "draft"), purchase("d2", 2, status = "draft", deletedAt = 3), purchase("c1", 3)),
            )
            assertEquals(1, queries.openDrafts().first())
            db.outbox().enqueueAll(listOf(OutboxEntry(tableName = "purchases", rowId = "d1", enqueuedAt = 1), OutboxEntry(tableName = "purchases", rowId = "c1", enqueuedAt = 1)))
            db.pendingUploads().enqueue(PendingUploadEntity(kind = "blob", imageId = "i1", name = "original.jpg", localPath = "/x", createdAt = 1))
            val open = db.syncIssues().add(SyncIssueEntity(tableName = "purchases", rowId = "d1", reason = "VALIDATION_ERROR", createdAt = 1))
            db.syncIssues().add(SyncIssueEntity(tableName = "purchases", rowId = "c1", reason = "VALIDATION_ERROR", createdAt = 1))
            db.syncIssues().resolve(open, at = 2)
            assertEquals(2, db.outbox().observeCount().first())
            assertEquals(1, db.pendingUploads().observeCount().first())
            assertEquals(1, db.syncIssues().observeUnresolvedCount().first())
        }
}
