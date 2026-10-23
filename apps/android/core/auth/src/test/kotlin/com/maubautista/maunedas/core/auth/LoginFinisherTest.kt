package com.maubautista.maunedas.core.auth

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.maubautista.maunedas.core.database.AppDatabase
import com.maubautista.maunedas.core.database.entity.OutboxEntry
import com.maubautista.maunedas.core.database.entity.PendingUploadEntity
import com.maubautista.maunedas.core.network.ApiConfig
import com.maubautista.maunedas.core.network.AuthInterceptor
import com.maubautista.maunedas.core.network.ClientInfo
import com.maubautista.maunedas.core.network.IdTokenProvider
import com.maubautista.maunedas.core.network.MaunedasJson
import com.maubautista.maunedas.core.network.TokenAuthenticator
import com.maubautista.maunedas.core.network.createMaunedasApi
import com.maubautista.maunedas.core.network.createOkHttpClient
import com.maubautista.maunedas.core.sync.DeviceIdStore
import com.maubautista.maunedas.core.sync.SyncScheduler
import com.maubautista.maunedas.core.sync.SyncStatusStore
import androidx.work.Configuration
import androidx.work.testing.SynchronousExecutor
import androidx.work.testing.WorkManagerTestInitHelper
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File

@RunWith(RobolectricTestRunner::class)
class LoginFinisherTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val server = MockWebServer()
    private lateinit var session: SessionStore
    private lateinit var finisher: LoginFinisher
    private lateinit var cleaner: SignOutCleaner
    private lateinit var db: AppDatabase
    private val deviceId by lazy { DeviceIdStore(context) }
    private var firebaseSignOuts = 0

    private fun json(
        code: Int,
        body: String,
    ) = MockResponse.Builder().code(code).addHeader("Content-Type", "application/json").body(body).build()

    private val me = """{"user":{"id":"u1","username":"mau","display_name":"Mauricio","role":"admin","has_google":true},"server_time":1,"schema_version":1,"min_client_schema":1}"""

    @Before
    fun start() {
        server.start()
        WorkManagerTestInitHelper.initializeTestWorkManager(context, Configuration.Builder().setExecutor(SynchronousExecutor()).build())
        val tokens = IdTokenProvider { "token" }
        val client = ClientInfo(1, "0.0.1-dev")
        val api = createMaunedasApi(ApiConfig(server.url("/").toString()), createOkHttpClient(AuthInterceptor(tokens, client), TokenAuthenticator(tokens)), MaunedasJson)
        db = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java).allowMainThreadQueries().build()
        session = SessionStore(context)
        finisher = LoginFinisher(api, session, deviceId, client)
        cleaner = SignOutCleaner(context, db, api, session, deviceId, SyncScheduler(context, db), SyncStatusStore(context))
    }

    @After
    fun stop() {
        db.close()
        server.close()
    }

    @Test
    fun aRegisteredUserIsSavedAndTheDeviceRegistered() =
        runTest {
            server.enqueue(json(200, me))
            server.enqueue(MockResponse.Builder().code(204).build())
            val result = finisher.finish { firebaseSignOuts++ }
            assertEquals(LoginResult.Success(SessionUser("u1", "mau", "Mauricio", "admin", true)), result)
            assertEquals(SessionUser("u1", "mau", "Mauricio", "admin", true), session.current())
            assertEquals("/v1/me", server.takeRequest().url.encodedPath)
            val device = Json.parseToJsonElement(server.takeRequest().body!!.utf8()).jsonObject
            assertEquals(deviceId.get(), device["device_id"]!!.jsonPrimitive.content)
            assertEquals("android", device["platform"]!!.jsonPrimitive.content)
            assertEquals("0.0.1-dev", device["app_version"]!!.jsonPrimitive.content)
            assertEquals(0, firebaseSignOuts)
        }

    @Test
    fun theWorkerDecidesWhoEnters() =
        runTest {
            server.enqueue(json(403, """{"error":{"code":"USER_NOT_ALLOWED","message":"x"}}"""))
            assertEquals(LoginResult.NotAllowed, finisher.finish { firebaseSignOuts++ })
            server.enqueue(json(403, """{"error":{"code":"USER_DISABLED","message":"x"}}"""))
            assertEquals(LoginResult.Disabled, finisher.finish { firebaseSignOuts++ })
            assertEquals(2, firebaseSignOuts)
            assertNull(session.current())
        }

    @Test
    fun withoutNetworkTheFirstLoginCannotFinish() =
        runTest {
            server.close()
            assertEquals(LoginResult.NoNetwork, finisher.finish { firebaseSignOuts++ })
            assertEquals(1, firebaseSignOuts)
        }

    @Test
    fun signingOutWipesEverythingLocalEvenOffline() =
        runTest {
            server.enqueue(json(200, me))
            server.enqueue(MockResponse.Builder().code(204).build())
            finisher.finish { }
            val oldDevice = deviceId.get()
            db.outbox().enqueueAll(listOf(OutboxEntry(tableName = "tags", rowId = "t1", enqueuedAt = 1)))
            db.pendingUploads().enqueue(PendingUploadEntity(kind = "blob", imageId = "i1", name = "original.jpg", localPath = "/x", createdAt = 1))
            val image = File(context.filesDir, "images/i1/original.jpg").apply { parentFile!!.mkdirs(); writeBytes(byteArrayOf(1)) }
            assertEquals(2, cleaner.pendingChanges())

            server.close()
            cleaner.signOut { firebaseSignOuts++ }

            assertEquals(1, firebaseSignOuts)
            assertEquals(0, cleaner.pendingChanges())
            assertFalse(image.exists())
            assertNull(session.current())
            assertTrue("a new device id after signing out", deviceId.get() != oldDevice)
        }
}
