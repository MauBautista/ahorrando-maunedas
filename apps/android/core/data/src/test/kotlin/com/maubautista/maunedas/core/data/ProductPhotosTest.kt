package com.maubautista.maunedas.core.data

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.maubautista.maunedas.core.database.AppDatabase
import com.maubautista.maunedas.core.database.entity.ImageEntity
import com.maubautista.maunedas.core.database.entity.ImageRenditionEntity
import com.maubautista.maunedas.core.database.entity.PendingUploadEntity
import com.maubautista.maunedas.core.network.ApiConfig
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File

/** 10 §1: thumb → processed → original for lists, processed → original for the big photo; the phone's file first. */
@RunWith(RobolectricTestRunner::class)
class ProductPhotosTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val db = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java).allowMainThreadQueries().build()
    private val photos = ProductPhotos(context, db, ApiConfig("https://api.test"))
    private val id = "0190d7e5-0000-7000-8000-00000000000a"

    @After
    fun close() = db.close()

    private suspend fun image(
        thumb: String? = null,
        processed: String? = null,
        deleted: Boolean = false,
    ) {
        db.images().upsertAll(
            listOf(
                ImageEntity(
                    id = id, ownerType = "product", ownerId = "p", role = "catalog", source = "user", originalKey = "images/$id/original.jpg",
                    selectedThumbId = thumb, selectedProcessedId = processed, deletedAt = if (deleted) 5 else null, createdAt = 1, updatedAt = 1,
                ),
            ),
        )
    }

    private suspend fun rendition(
        rid: String,
        kind: String,
    ) = db.imageRenditions().upsertAll(listOf(ImageRenditionEntity(id = rid, imageId = id, kind = kind, tier = "home", r2Key = "images/$id/$rid.webp", createdAt = 1, updatedAt = 1)))

    private fun blob(name: String) = "https://api.test/v1/images/$id/blobs/$name"

    @Test
    fun withOnlyTheOriginalBothUseItAndTheFileOnThePhoneWins() =
        runTest {
            assertNull(photos.thumb(null))
            assertNull(photos.thumb(id))
            image()
            assertEquals(blob("original.jpg"), photos.thumb(id))
            assertEquals(blob("original.jpg"), photos.large(id))
            val local = File(context.filesDir, "images/$id/original.jpg").apply { parentFile?.mkdirs(); writeText("jpg") }
            assertEquals(local, photos.thumb(id))
            local.delete()
            // A deleted image shows nothing.
            image(deleted = true)
            assertNull(photos.large(id))
        }

    @Test
    fun renditionsComeFirstInTheOrderOfEachUse() =
        runTest {
            rendition("t", "thumb")
            rendition("q", "processed")
            image(thumb = "t", processed = "q")
            assertEquals(blob("t.webp"), photos.thumb(id))
            assertEquals(blob("q.webp"), photos.large(id))
            // The original on the phone beats a rendition that is only on the server.
            File(context.filesDir, "images/$id/original.jpg").apply { parentFile?.mkdirs(); writeText("jpg") }
            assertEquals(File(context.filesDir, "images/$id/original.jpg"), photos.thumb(id))
            File(context.filesDir, "images/$id/original.jpg").delete()
            // A selected rendition that was deleted is skipped.
            db.imageRenditions().upsertAll(listOf(ImageRenditionEntity(id = "t", imageId = id, kind = "thumb", tier = "home", r2Key = "images/$id/t.webp", deletedAt = 9, createdAt = 1, updatedAt = 9)))
            assertEquals(blob("q.webp"), photos.thumb(id))
        }

    @Test
    fun aPhotoStillInTheQueueIsNotAskedFor() =
        runTest {
            image()
            val upload = db.pendingUploads().enqueue(PendingUploadEntity(kind = "import", imageId = id, name = "original.jpg", sourceUrl = "https://images.openfoodfacts.org/f.jpg", createdAt = 1))
            // The server does not have it yet: the initial shows instead of a 404.
            assertNull(photos.thumb(id))
            // A file on the phone is shown while it waits.
            File(context.filesDir, "images/$id/original.jpg").apply { parentFile?.mkdirs(); writeText("jpg") }
            assertEquals(File(context.filesDir, "images/$id/original.jpg"), photos.thumb(id))
            File(context.filesDir, "images/$id/original.jpg").delete()
            db.pendingUploads().remove(upload)
            assertEquals(blob("original.jpg"), photos.thumb(id))
        }
}
