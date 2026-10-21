package com.maubautista.maunedas.core.sync

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.work.Configuration
import androidx.work.NetworkType
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.testing.SynchronousExecutor
import androidx.work.testing.WorkManagerTestInitHelper
import com.maubautista.maunedas.core.database.AppDatabase
import com.maubautista.maunedas.core.database.entity.PendingUploadEntity
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.util.concurrent.TimeUnit

/** Scheduling of 04 §6.6. */
@RunWith(RobolectricTestRunner::class)
class SyncSchedulerTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private lateinit var scheduler: SyncScheduler
    private lateinit var db: AppDatabase

    @Before
    fun init() {
        WorkManagerTestInitHelper.initializeTestWorkManager(context, Configuration.Builder().setExecutor(SynchronousExecutor()).build())
        db = androidx.room.Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java).allowMainThreadQueries().build()
        scheduler = SyncScheduler(context, db)
    }

    private fun infos(name: String) = WorkManager.getInstance(context).getWorkInfosForUniqueWork(name).get()

    @Test
    fun aLocalWriteAsksForOneSyncNowSoonWithNetwork() {
        scheduler.requestSoon()
        val info = infos(SyncScheduler.NOW).single()
        assertEquals(WorkInfo.State.ENQUEUED, info.state)
        assertEquals(NetworkType.CONNECTED, info.constraints.requiredNetworkType)
        assertEquals(TimeUnit.SECONDS.toMillis(3), info.initialDelayMillis)
    }

    @Test
    fun theSyncNowButtonAndThePeriodicSync() {
        scheduler.syncNow()
        assertEquals(NetworkType.CONNECTED, infos(SyncScheduler.NOW).single().constraints.requiredNetworkType)
        scheduler.schedulePeriodic()
        scheduler.schedulePeriodic()
        val periodic = infos(SyncScheduler.PERIODIC).single()
        assertEquals(TimeUnit.MINUTES.toMillis(15), periodic.periodicityInfo!!.repeatIntervalMillis)
        scheduler.cancelAll()
        assertTrue(infos(SyncScheduler.PERIODIC).all { it.state == WorkInfo.State.CANCELLED })
    }

    @Test
    fun uploadsAreScheduledOnlyWhenSomethingWaits() =
        runTest {
            scheduler.enqueueIfPending()
            assertTrue(infos(SyncScheduler.UPLOAD).isEmpty())
            db.pendingUploads().enqueue(PendingUploadEntity(kind = "blob", imageId = "i1", name = "original.jpg", localPath = "/x", createdAt = 1))
            scheduler.enqueueIfPending()
            val info = infos(SyncScheduler.UPLOAD).single()
            assertEquals(NetworkType.CONNECTED, info.constraints.requiredNetworkType)
            db.close()
        }
}
