package com.maubautista.maunedas.core.data

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.work.Configuration
import androidx.work.WorkManager
import androidx.work.testing.SynchronousExecutor
import androidx.work.testing.WorkManagerTestInitHelper
import com.maubautista.maunedas.core.database.AppDatabase
import com.maubautista.maunedas.core.database.entity.ImageEntity
import com.maubautista.maunedas.core.database.entity.ImageRenditionEntity
import com.maubautista.maunedas.core.model.Clock
import com.maubautista.maunedas.core.sync.LocalWriter
import com.maubautista.maunedas.core.sync.SyncScheduler
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** "Mejorar en casa" from Room (10 §6.1): what the product page offers, and the request by sync and worker. */
@RunWith(RobolectricTestRunner::class)
class PhotoEnhancerTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val db = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java).allowMainThreadQueries().build()
    private var now = 1_000L
    private val clock = Clock { now }
    private val enhancer = PhotoEnhancer(db, LocalWriter(db, clock, { "u" }, { }), SyncScheduler(context, db), clock)

    @Before
    fun work() {
        WorkManagerTestInitHelper.initializeTestWorkManager(context, Configuration.Builder().setExecutor(SynchronousExecutor()).build())
    }

    @After
    fun close() = db.close()

    private fun image(
        id: String,
        role: String = "catalog",
        originalKey: String? = "images/$id/original.jpg",
        deletedAt: Long? = null,
    ) = ImageEntity(id = id, ownerType = "product", ownerId = "p1", role = role, source = "user", originalKey = originalKey, createdAt = 1, updatedAt = 1, deletedAt = deletedAt)

    @Test
    fun onlyAProductPhotoWithItsOriginalCanBeEnhanced() =
        runTest {
            db.images().upsertAll(listOf(image("photo"), image("receipt", role = "receipt"), image("importing", originalKey = null), image("gone", deletedAt = 5)))
            assertEquals(EnhanceState.AVAILABLE, enhancer.state("photo").first())
            for (id in listOf("receipt", "importing", "gone", "unknown")) assertEquals(id, EnhanceState.NONE, enhancer.state(id).first())
            assertEquals(EnhanceState.NONE, enhancer.state(null).first())
        }

    @Test
    fun askingWritesTheRequestQueuesTheWorkerAndWaitsForTheResult() =
        runTest {
            db.images().upsertAll(listOf(image("photo")))
            enhancer.request("photo")
            assertEquals(1_000L, db.images().byId("photo")!!.enhanceRequestedAt)
            assertEquals(1, db.outbox().pendingFor("images", "photo"))
            val work = WorkManager.getInstance(context).getWorkInfosForUniqueWork("enhance:photo").get()
            assertEquals(1, work.size)
            assertEquals(EnhanceState.PENDING, enhancer.state("photo").first())
            // A result from before the request is not its answer; one from after is.
            fun home(
                id: String,
                at: Long,
            ) = ImageRenditionEntity(id = id, imageId = "photo", kind = "thumb", tier = "home", r2Key = "images/photo/$id.webp", createdAt = at, updatedAt = at)
            db.imageRenditions().upsertAll(listOf(home("old", 999)))
            assertEquals(EnhanceState.PENDING, enhancer.state("photo").first())
            db.imageRenditions().upsertAll(listOf(home("new", 1_000)))
            assertEquals(EnhanceState.AVAILABLE, enhancer.state("photo").first())
            // Nothing is asked for a photo that cannot be enhanced.
            db.images().upsertAll(listOf(image("receipt", role = "receipt")))
            enhancer.request("receipt")
            assertEquals(null, db.images().byId("receipt")!!.enhanceRequestedAt)
            assertEquals(0, WorkManager.getInstance(context).getWorkInfosForUniqueWork("enhance:receipt").get().size)
        }
}
