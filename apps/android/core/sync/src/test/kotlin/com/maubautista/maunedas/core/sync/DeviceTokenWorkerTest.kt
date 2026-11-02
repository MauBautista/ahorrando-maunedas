package com.maubautista.maunedas.core.sync

import android.content.Context
import androidx.work.ListenableWorker
import androidx.work.WorkerFactory
import androidx.work.WorkerParameters
import androidx.work.testing.TestListenableWorkerBuilder
import androidx.work.workDataOf
import com.maubautista.maunedas.core.network.ApiConfig
import com.maubautista.maunedas.core.network.AuthInterceptor
import com.maubautista.maunedas.core.network.ClientInfo
import com.maubautista.maunedas.core.network.IdTokenProvider
import com.maubautista.maunedas.core.network.MaunedasJson
import com.maubautista.maunedas.core.network.TokenAuthenticator
import com.maubautista.maunedas.core.network.createMaunedasApi
import com.maubautista.maunedas.core.network.createOkHttpClient
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** The FCM token reaching the Worker (08 §6): once, retried only when it may work later. */
@RunWith(RobolectricTestRunner::class)
class DeviceTokenWorkerTest {
    private val server = MockWebServer()
    private lateinit var env: TestEnv

    @Before
    fun start() {
        server.start()
        env = TestEnv()
    }

    @After
    fun stop() {
        env.close()
        env.deviceId.clear()
        server.close()
    }

    private suspend fun run(token: String? = "tok-1"): ListenableWorker.Result {
        val tokens = IdTokenProvider { "token" }
        val api = createMaunedasApi(ApiConfig(server.url("/").toString()), createOkHttpClient(AuthInterceptor(tokens, ClientInfo(1, "test")), TokenAuthenticator(tokens)), MaunedasJson)
        val factory =
            object : WorkerFactory() {
                override fun createWorker(
                    appContext: Context,
                    workerClassName: String,
                    workerParameters: WorkerParameters,
                ) = DeviceTokenWorker(appContext, workerParameters, env.user, api, env.deviceId, ClientInfo(1, "1.2.3"))
            }
        val input = token?.let { workDataOf(DeviceTokenWorker.TOKEN to it) } ?: workDataOf()
        return TestListenableWorkerBuilder<DeviceTokenWorker>(env.context).setWorkerFactory(factory).setInputData(input).build().doWork()
    }

    private fun answer(code: Int) = MockResponse.Builder().code(code).addHeader("Content-Type", "application/json").body(if (code < 300) "" else """{"error":{"code":"X","message":"x"}}""").build()

    @Test
    fun sendsANewTokenOnce() =
        runTest {
            server.enqueue(answer(204))
            assertEquals(ListenableWorker.Result.success(), run())
            val sent = Json.parseToJsonElement(server.takeRequest().body!!.utf8()).jsonObject
            assertEquals(env.deviceId.get(), sent["device_id"]!!.jsonPrimitive.content)
            assertEquals(listOf("android", "tok-1", "1.2.3"), listOf("platform", "fcm_token", "app_version").map { sent[it]!!.jsonPrimitive.content })
            assertEquals("tok-1", env.deviceId.registeredToken())
            // The same token again: nothing to send.
            assertEquals(ListenableWorker.Result.success(), run())
            assertEquals(1, server.requestCount)
            // Signing out forgets it, so the next session sends it again.
            env.deviceId.clear()
            assertNull(env.deviceId.registeredToken())
        }

    @Test
    fun retriesNetworkAndServerErrorsOnly() =
        runTest {
            server.enqueue(answer(503))
            assertEquals(ListenableWorker.Result.retry(), run())
            server.enqueue(answer(400))
            assertEquals(ListenableWorker.Result.failure(), run())
            assertNull(env.deviceId.registeredToken())
            server.close()
            assertEquals(ListenableWorker.Result.retry(), run())
        }

    @Test
    fun withoutASessionOrATokenItDoesNothing() =
        runTest {
            assertEquals(ListenableWorker.Result.failure(), run(token = null))
            env.userId = null
            assertEquals(ListenableWorker.Result.success(), run())
            assertEquals(0, server.requestCount)
        }
}
