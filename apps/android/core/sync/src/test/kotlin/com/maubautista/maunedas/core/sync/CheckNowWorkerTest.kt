package com.maubautista.maunedas.core.sync

import android.content.Context
import androidx.work.Configuration
import androidx.work.ListenableWorker
import androidx.work.WorkerFactory
import androidx.work.WorkerParameters
import androidx.work.testing.SynchronousExecutor
import androidx.work.testing.TestListenableWorkerBuilder
import androidx.work.testing.WorkManagerTestInitHelper
import androidx.work.workDataOf
import com.maubautista.maunedas.core.database.entity.OutboxEntry
import com.maubautista.maunedas.core.network.ApiConfig
import com.maubautista.maunedas.core.network.AuthInterceptor
import com.maubautista.maunedas.core.network.ClientInfo
import com.maubautista.maunedas.core.network.IdTokenProvider
import com.maubautista.maunedas.core.network.MaunedasJson
import com.maubautista.maunedas.core.network.TokenAuthenticator
import com.maubautista.maunedas.core.network.createMaunedasApi
import com.maubautista.maunedas.core.network.createOkHttpClient
import kotlinx.coroutines.test.runTest
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** "Revisar ahora" through WorkManager (S-20): what the worker answers for each outcome. */
@RunWith(RobolectricTestRunner::class)
class CheckNowWorkerTest {
    private val server = MockWebServer()
    private lateinit var env: TestEnv

    @Before
    fun start() {
        server.start()
        env = TestEnv()
        WorkManagerTestInitHelper.initializeTestWorkManager(env.context, Configuration.Builder().setExecutor(SynchronousExecutor()).build())
    }

    @After
    fun stop() {
        env.close()
        server.close()
    }

    private suspend fun run(listingId: String? = "l1"): ListenableWorker.Result {
        val tokens = IdTokenProvider { "token" }
        val api = createMaunedasApi(ApiConfig(server.url("/").toString()), createOkHttpClient(AuthInterceptor(tokens, ClientInfo(1, "test")), TokenAuthenticator(tokens)), MaunedasJson)
        val factory =
            object : WorkerFactory() {
                override fun createWorker(
                    appContext: Context,
                    workerClassName: String,
                    workerParameters: WorkerParameters,
                ) = CheckNowWorker(appContext, workerParameters, env.user, env.db, api, SyncScheduler(appContext, env.db))
            }
        val input = listingId?.let { workDataOf(CheckNowWorker.LISTING_ID to it) } ?: workDataOf()
        return TestListenableWorkerBuilder<CheckNowWorker>(env.context).setWorkerFactory(factory).setInputData(input).build().doWork()
    }

    private fun answer(code: Int) = MockResponse.Builder().code(code).addHeader("Content-Type", "application/json").body(if (code == 202) "" else """{"error":{"code":"X","message":"x"}}""").build()

    @Test
    fun asksTheWorkerAndSucceeds() =
        runTest {
            server.enqueue(answer(202))
            assertEquals(ListenableWorker.Result.success(), run())
            val request = server.takeRequest()
            assertEquals("POST", request.method)
            assertEquals("/v1/listings/l1/check-now", request.target)
        }

    @Test
    fun aListingStillInTheOutboxIsPushedFirst() =
        runTest {
            env.db.outbox().enqueueAll(listOf(OutboxEntry(tableName = "listings", rowId = "l1", enqueuedAt = 1)))
            assertEquals(ListenableWorker.Result.retry(), run())
            assertEquals(0, server.requestCount)
        }

    @Test
    fun retriesNetworkAndServerErrorsOnly() =
        runTest {
            server.enqueue(answer(503))
            assertEquals(ListenableWorker.Result.retry(), run())
            server.enqueue(answer(404))
            assertEquals(ListenableWorker.Result.success(), run())
            server.close()
            assertEquals(ListenableWorker.Result.retry(), run())
        }

    @Test
    fun withoutASessionOrAListingItDoesNothing() =
        runTest {
            assertEquals(ListenableWorker.Result.failure(), run(listingId = null))
            env.userId = null
            assertEquals(ListenableWorker.Result.success(), run())
            assertEquals(0, server.requestCount)
        }
}
