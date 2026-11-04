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

/** "Mejorar en casa" through WorkManager (10 §6.1): what the worker answers for each outcome. */
@RunWith(RobolectricTestRunner::class)
class EnhanceWorkerTest {
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

    private suspend fun run(imageId: String? = "i1"): ListenableWorker.Result {
        val tokens = IdTokenProvider { "token" }
        val api = createMaunedasApi(ApiConfig(server.url("/").toString()), createOkHttpClient(AuthInterceptor(tokens, ClientInfo(1, "test")), TokenAuthenticator(tokens)), MaunedasJson)
        val factory =
            object : WorkerFactory() {
                override fun createWorker(
                    appContext: Context,
                    workerClassName: String,
                    workerParameters: WorkerParameters,
                ) = EnhanceWorker(appContext, workerParameters, env.user, env.db, api, SyncScheduler(appContext, env.db))
            }
        val input = imageId?.let { workDataOf(EnhanceWorker.IMAGE_ID to it) } ?: workDataOf()
        return TestListenableWorkerBuilder<EnhanceWorker>(env.context).setWorkerFactory(factory).setInputData(input).build().doWork()
    }

    private fun answer(
        code: Int,
        error: String = "X",
    ) = MockResponse.Builder().code(code).addHeader("Content-Type", "application/json")
        .body(if (code == 202) """{"job_id":"j1"}""" else """{"error":{"code":"$error","message":"x"}}""").build()

    @Test
    fun asksTheWorkerAndSucceeds() =
        runTest {
            server.enqueue(answer(202))
            assertEquals(ListenableWorker.Result.success(), run())
            val request = server.takeRequest()
            assertEquals(listOf("POST", "/v1/images/i1/enhance"), listOf(request.method, request.target))
        }

    @Test
    fun anImageStillInTheOutboxIsPushedFirst() =
        runTest {
            env.db.outbox().enqueueAll(listOf(OutboxEntry(tableName = "images", rowId = "i1", enqueuedAt = 1)))
            assertEquals(ListenableWorker.Result.retry(), run())
            assertEquals(0, server.requestCount)
        }

    @Test
    fun waitsForTheOriginalAndTheServerButNotForAGonePhoto() =
        runTest {
            server.enqueue(answer(409, "IMAGE_NOT_UPLOADED"))
            assertEquals(ListenableWorker.Result.retry(), run())
            server.enqueue(answer(503))
            assertEquals(ListenableWorker.Result.retry(), run())
            server.enqueue(answer(404, "NOT_FOUND"))
            assertEquals(ListenableWorker.Result.success(), run())
            server.enqueue(answer(409, "IMAGE_NOT_FOUND"))
            assertEquals(ListenableWorker.Result.success(), run())
        }

    @Test
    fun withoutNetworkSessionOrImage() =
        runTest {
            server.close()
            assertEquals(ListenableWorker.Result.retry(), run())
            env.userId = null
            assertEquals(ListenableWorker.Result.success(), run())
            env.userId = ME
            assertEquals(ListenableWorker.Result.failure(), run(null))
        }
}
