package com.maubautista.maunedas.core.data

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.maubautista.maunedas.core.database.AppDatabase
import com.maubautista.maunedas.core.model.Clock
import com.maubautista.maunedas.core.network.ApiConfig
import com.maubautista.maunedas.core.sync.LocalWriter
import com.maubautista.maunedas.core.sync.UploadQueue
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File

/** RF-TIC-01: pages written as they are taken, in page order, at most four, each one queued for upload. */
@RunWith(RobolectricTestRunner::class)
class ReceiptPhotosTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private var now = 1_000L
    private val db = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java).allowMainThreadQueries().build()
    private val clock = Clock { now }
    private val writer = LocalWriter(db, clock, { "u1" }, { })
    private val receipts = ReceiptPhotos(db, writer, clock, LocalPhotos(context), ProductPhotos(context, db, ApiConfig("https://api.test")), UploadQueue(db, clock) { })

    @After
    fun close() = db.close()

    private fun page(name: String) = File(context.cacheDir, "capture/$name-reduced.jpg").apply { parentFile?.mkdirs(); writeText(name) }

    private suspend fun rows() = db.images().liveOf("purchase", "p", "receipt").sortedBy { it.createdAt }

    @Test
    fun pagesAreWrittenInOrderAndQueuedForUpload() =
        runTest {
            val first = page("one")
            assertEquals(2, receipts.attach("p", listOf(first, page("two"))))
            val rows = rows()
            assertEquals(listOf("purchase", "receipt", "user"), listOf(rows[0].ownerType, rows[0].role, rows[0].source))
            assertEquals(listOf(1_000L, 1_001L), rows.map { it.createdAt })
            assertEquals(rows.map { "images/${it.id}/original.jpg" }, rows.map { it.originalKey })
            assertFalse(first.exists())
            // The flow gives them in page order, from the files on the phone.
            val pages = receipts.pages("p").first()
            assertEquals(listOf("one", "two"), pages.map { (it.photo as File).readText() })
            assertEquals(rows.map { it.id }, db.pendingUploads().next(10).map { it.imageId })
        }

    @Test
    fun aReceiptHasAtMostFourPagesAndLaterOnesGoAfter() =
        runTest {
            receipts.attach("p", listOf(page("a"), page("b"), page("c")))
            // Taken in the same millisecond as the others, the next page still sorts after them.
            val extra = page("e")
            assertEquals(1, receipts.attach("p", listOf(page("d"), extra)))
            assertFalse(extra.exists())
            assertEquals(listOf("a", "b", "c", "d"), receipts.pages("p").first().map { (it.photo as File).readText() })
            assertEquals(0, receipts.attach("p", listOf(page("f"))))
            // Taking one away makes room; its row is a tombstone.
            val second = rows()[1]
            now = 5_000
            receipts.remove(second.id)
            assertEquals(5_000L, db.images().byId(second.id)!!.deletedAt)
            assertEquals(listOf("a", "c", "d"), receipts.pages("p").first().map { (it.photo as File).readText() })
            assertEquals(1, receipts.attach("p", listOf(page("g"))))
        }
}
