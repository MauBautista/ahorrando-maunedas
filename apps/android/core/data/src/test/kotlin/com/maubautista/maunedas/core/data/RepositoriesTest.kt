package com.maubautista.maunedas.core.data

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.maubautista.maunedas.core.database.AppDatabase
import com.maubautista.maunedas.core.database.entity.OutboxEntry
import com.maubautista.maunedas.core.database.entity.PendingUploadEntity
import com.maubautista.maunedas.core.database.entity.PurchaseEntity
import com.maubautista.maunedas.core.database.entity.StoreEntity
import com.maubautista.maunedas.core.database.entity.SyncIssueEntity
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.time.Instant
import java.time.YearMonth

@RunWith(RobolectricTestRunner::class)
class RepositoriesTest {
    private val db =
        Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext<Context>(), AppDatabase::class.java).allowMainThreadQueries().build()

    @After
    fun close() = db.close()

    private fun purchase(
        id: String,
        iso: String,
        total: Long,
        status: String = "confirmed",
    ) = PurchaseEntity(
        id = id, storeId = "s1", purchasedAt = Instant.parse(iso).toEpochMilli(), currency = "MXN", discountCents = 0, totalCents = total,
        source = "manual", status = status, createdAt = 1, updatedAt = 1,
    )

    @Test
    fun theMonthSpendingUsesMexicoCityMonths() =
        runTest {
            db.purchases().upsertAll(
                listOf(
                    // 30 September 23:59 in Mexico City.
                    purchase("sep", "2026-10-01T05:59:00Z", 1),
                    // 1 October 00:00 and 31 October 23:59 in Mexico City.
                    purchase("first", "2026-10-01T06:00:00Z", 10),
                    purchase("last", "2026-11-01T05:59:00Z", 100),
                    purchase("nov", "2026-11-01T06:00:00Z", 1_000),
                ),
            )
            val purchases = PurchaseRepository(db)
            assertEquals(110L, purchases.spentIn(YearMonth.of(2026, 10)).first())
            assertEquals(1L, purchases.spentIn(YearMonth.of(2026, 9)).first())
        }

    @Test
    fun recentPurchasesSayWhichOnesAreDrafts() =
        runTest {
            db.stores().upsertAll(listOf(StoreEntity(id = "s1", name = "Soriana", kind = "physical", defaultCheckIntervalMin = 360, createdAt = 1, updatedAt = 1)))
            db.purchases().upsertAll(listOf(purchase("a", "2026-10-20T18:00:00Z", 2_350, status = "draft"), purchase("b", "2026-10-19T18:00:00Z", 900)))
            val recent = PurchaseRepository(db).recent(5).first()
            assertEquals(listOf("a" to true, "b" to false), recent.map { it.id to it.draft })
            assertEquals(PurchaseSummary("a", "Soriana", null, Instant.parse("2026-10-20T18:00:00Z").toEpochMilli(), 2_350, 0, true), recent[0])
            assertEquals(1, PurchaseRepository(db).openDrafts().first())
        }

    @Test
    fun theBacklogAddsChangesAndPhotosAndCountsOpenRejections() =
        runTest {
            val health = SyncHealthRepository(db)
            assertEquals(SyncBacklog(pending = 0, rejected = 0), health.backlog().first())
            db.outbox().enqueueAll(listOf(OutboxEntry(tableName = "tags", rowId = "t1", enqueuedAt = 1)))
            db.pendingUploads().enqueue(PendingUploadEntity(kind = "blob", imageId = "i1", name = "original.jpg", localPath = "/x", createdAt = 1))
            db.pendingUploads().enqueue(PendingUploadEntity(kind = "blob", imageId = "i1", name = "thumb.webp", localPath = "/y", createdAt = 1))
            val solved = db.syncIssues().add(SyncIssueEntity(tableName = "tags", rowId = "t1", reason = "VALIDATION_ERROR", createdAt = 1))
            db.syncIssues().add(SyncIssueEntity(tableName = "tags", rowId = "t2", reason = "VALIDATION_ERROR", createdAt = 1))
            db.syncIssues().resolve(solved, at = 2)
            assertEquals(SyncBacklog(pending = 3, rejected = 1), health.backlog().first())
        }
}
