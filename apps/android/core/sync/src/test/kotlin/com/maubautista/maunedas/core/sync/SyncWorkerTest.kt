package com.maubautista.maunedas.core.sync

import android.content.Context
import androidx.work.ListenableWorker
import androidx.work.WorkerFactory
import androidx.work.WorkerParameters
import androidx.work.testing.TestListenableWorkerBuilder
import kotlinx.coroutines.test.runTest
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** What the worker answers WorkManager for each outcome (04 §6.3). */
@RunWith(RobolectricTestRunner::class)
class SyncWorkerTest {
    private val server = MockWebServer()
    private lateinit var env: TestEnv
    private var uploadRequests = 0

    @Before
    fun start() {
        server.start()
        env = TestEnv(server)
    }

    @After
    fun stop() {
        env.close()
        server.close()
    }

    private suspend fun run(): ListenableWorker.Result {
        val factory =
            object : WorkerFactory() {
                override fun createWorker(
                    appContext: Context,
                    workerClassName: String,
                    workerParameters: WorkerParameters,
                ) = SyncWorker(appContext, workerParameters, env.user, env.engine!!, env.status, env.clock) { uploadRequests++ }
            }
        return TestListenableWorkerBuilder<SyncWorker>(env.context).setWorkerFactory(factory).build().doWork()
    }

    @Test
    fun withoutASessionItDoesNothing() =
        runTest {
            env.userId = null
            assertEquals(ListenableWorker.Result.success(), run())
            assertEquals(0, server.requestCount)
        }

    @Test
    fun successMarksTheStatus() =
        runTest {
            server.enqueue(json(200, EMPTY_PULL))
            assertEquals(ListenableWorker.Result.success(), run())
            assertTrue(env.status.status.value is SyncStatus.Synced)
            // Rows are on the server: their binaries may go now (04 §6.6).
            assertEquals(1, uploadRequests)
        }

    @Test
    fun serverErrorsAndNetworkFailuresRetry() =
        runTest {
            server.enqueue(json(503, """{"error":{"code":"AI_UNAVAILABLE","message":"x"}}"""))
            assertEquals(ListenableWorker.Result.retry(), run())
            server.close()
            assertEquals(ListenableWorker.Result.retry(), run())
            assertEquals(SyncStatus.Failed(env.clock.now, "NETWORK"), env.status.status.value)
        }

    @Test
    fun aClientErrorFailsAndAnOldAppWaitsForAnUpdate() =
        runTest {
            server.enqueue(json(400, """{"error":{"code":"VALIDATION_ERROR","message":"x"}}"""))
            assertEquals(ListenableWorker.Result.failure(), run())
            server.enqueue(json(426, """{"error":{"code":"UPGRADE_REQUIRED","message":"Actualiza la app."}}"""))
            assertEquals(ListenableWorker.Result.success(), run())
            assertEquals(SyncStatus.UpgradeRequired, env.status.status.value)
        }
}
