package com.maubautista.maunedas.core.network

import com.maubautista.maunedas.core.network.dto.DeviceRegistration
import com.maubautista.maunedas.core.network.dto.Mutation
import com.maubautista.maunedas.core.network.dto.PullCursor
import com.maubautista.maunedas.core.network.dto.PullRequest
import com.maubautista.maunedas.core.network.dto.PushRequest
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test

class MaunedasApiTest {
    private val server = MockWebServer()

    /** Fake Firebase: hands out numbered tokens and records whether a refresh was forced. */
    private class FakeTokens(var signedIn: Boolean = true) : IdTokenProvider {
        val calls = mutableListOf<Boolean>()

        override fun idToken(forceRefresh: Boolean): String? {
            calls += forceRefresh
            return if (signedIn) "token-${calls.size}" else null
        }
    }

    private val tokens = FakeTokens()
    private lateinit var api: MaunedasApi

    @Before
    fun start() {
        server.start()
        val client = ClientInfo(schema = 1, appVersion = "0.0.1-dev")
        val http = createOkHttpClient(AuthInterceptor(tokens, client), TokenAuthenticator(tokens))
        api = createMaunedasApi(ApiConfig(server.url("/").toString().removeSuffix("/")), http, MaunedasJson)
    }

    @After
    fun stop() = server.close()

    private fun json(
        code: Int,
        body: String,
    ) = MockResponse.Builder().code(code).addHeader("Content-Type", "application/json").body(body).build()

    private val me =
        """{"user":{"id":"u1","username":"mau","display_name":"Mauricio","role":"admin","has_google":true},
            "server_time":1,"schema_version":1,"min_client_schema":1,"extra":"ignored"}"""

    @Test
    fun sendsTheTokenAndTheClientHeaders() =
        runTest {
            server.enqueue(json(200, me))
            val response = api.me()
            assertEquals("Mauricio", response.user.displayName)
            assertTrue(response.user.hasGoogle)
            val request = server.takeRequest()
            assertEquals("/v1/me", request.url.encodedPath)
            assertEquals("Bearer token-1", request.headers["Authorization"])
            assertEquals("1", request.headers["X-Client-Schema"])
            assertEquals("0.0.1-dev", request.headers["X-Client-Version"])
            assertEquals(listOf(false), tokens.calls)
        }

    @Test
    fun withoutASessionThereIsNoAuthorizationHeader() =
        runTest {
            tokens.signedIn = false
            server.enqueue(json(200, me))
            api.me()
            val request = server.takeRequest()
            assertNull(request.headers["Authorization"])
            assertEquals("1", request.headers["X-Client-Schema"])
        }

    @Test
    fun a401RefreshesTheTokenAndRetriesOnce() =
        runTest {
            server.enqueue(json(401, """{"error":{"code":"INVALID_TOKEN","message":"Tu sesión expiró.","request_id":"r1"}}"""))
            server.enqueue(json(200, me))
            assertEquals("mau", api.me().user.username)
            assertEquals("Bearer token-1", server.takeRequest().headers["Authorization"])
            val retry = server.takeRequest()
            assertEquals("Bearer token-2", retry.headers["Authorization"])
            assertEquals("1", retry.headers["X-Auth-Retry"])
            assertEquals(listOf(false, true), tokens.calls)
        }

    @Test
    fun aSecond401IsNotRetriedAgainAndBecomesAnApiException() =
        runTest {
            repeat(3) { server.enqueue(json(401, """{"error":{"code":"INVALID_TOKEN","message":"Tu sesión expiró."}}""")) }
            val error = runCatching { api.me() }.exceptionOrNull() as ApiException
            assertEquals(401, error.status)
            assertEquals("INVALID_TOKEN", error.code)
            assertEquals(2, server.requestCount)
        }

    @Test
    fun errorsBecomeApiExceptionsWithCodeDetailsAndRequestId() =
        runTest {
            server.enqueue(
                json(409, """{"error":{"code":"MERGE_INVALID","message":"No se pueden fusionar.","details":{"reason":"SAME"},"request_id":"req-9"}}"""),
            )
            try {
                api.barcode("7501020515343")
                fail("expected ApiException")
            } catch (e: ApiException) {
                assertEquals(409, e.status)
                assertEquals("MERGE_INVALID", e.code)
                assertEquals("No se pueden fusionar.", e.message)
                assertEquals("SAME", e.details!!["reason"]!!.jsonPrimitive.content)
                assertEquals("req-9", e.requestId)
            }
        }

    @Test
    fun upgradeRequiredHasItsOwnException() =
        runTest {
            server.enqueue(json(426, """{"error":{"code":"UPGRADE_REQUIRED","message":"Actualiza la app.","request_id":"r"}}"""))
            assertThrows(UpgradeRequiredException::class.java) { kotlinx.coroutines.runBlocking { api.me() } }
        }

    @Test
    fun aBodyThatIsNotTheWorkerErrorFormatIsHttpError() =
        runTest {
            server.enqueue(MockResponse.Builder().code(502).addHeader("X-Request-Id", "edge-1").body("<html>Bad gateway</html>").build())
            val error = runCatching { api.me() }.exceptionOrNull() as ApiException
            assertEquals(502, error.status)
            assertEquals("HTTP_ERROR", error.code)
            assertEquals("edge-1", error.requestId)
        }

    @Test
    fun aNetworkFailureIsAnIOExceptionNotAnApiException() =
        runTest {
            server.close()
            val error = runCatching { api.me() }.exceptionOrNull()
            assertTrue("$error", error is java.io.IOException)
        }

    @Test
    fun syncBodiesUseSnakeCaseTuplesForCursorsAndExplicitNulls() =
        runTest {
            server.enqueue(
                json(
                    200,
                    """{"changes":{"products":[{"id":"p1","name":"Leche","brand":null,"new_column":1}]},
                        "cursors":{"products":[118,"p1"],"stores":[0,""]},"has_more":true,"server_time":5,"schema_version":1}""",
                ),
            )
            val pulled = api.pull(PullRequest(cursors = mapOf("products" to PullCursor(117, "p0"), "stores" to PullCursor.START)))
            assertEquals(
                // No "tables" key: the Worker rejects null (found on the first device test).
                """{"cursors":{"products":[117,"p0"],"stores":[0,""]},"limit":100}""",
                server.takeRequest().body!!.utf8(),
            )
            assertEquals(PullCursor(118, "p1"), pulled.cursors["products"])
            assertTrue(pulled.hasMore)
            assertEquals(JsonNull, pulled.changes.getValue("products").single()["brand"])

            server.enqueue(json(200, """{"applied":1,"skipped":0,"conflicts":[{"table":"barcodes","id":"b1","reason":"BARCODE_TAKEN","server_row":{"id":"b1"},"details":{"variant_id":"v9"}}]}"""))
            val row =
                buildJsonObject {
                    put("id", "p1")
                    put("brand", JsonNull)
                }
            val pushed = api.push(PushRequest(deviceId = "d1", mutations = listOf(Mutation("products", row))))
            assertEquals(
                """{"device_id":"d1","mutations":[{"table":"products","row":{"id":"p1","brand":null}}]}""",
                server.takeRequest().body!!.utf8(),
            )
            assertEquals("BARCODE_TAKEN", pushed.conflicts.single().reason)
            assertEquals("v9", pushed.conflicts.single().details!!.jsonObject["variant_id"]!!.jsonPrimitive.content)
        }

    @Test
    fun aPullOfSomeTablesSendsTheirNames() =
        runTest {
            server.enqueue(json(200, """{"changes":{},"cursors":{},"has_more":false,"server_time":1,"schema_version":1}"""))
            api.pull(PullRequest(cursors = emptyMap(), tables = listOf("stores")))
            assertEquals("""{"cursors":{},"limit":100,"tables":["stores"]}""", server.takeRequest().body!!.utf8())
        }

    @Test
    fun noContentAnswersAndBinaryUploads() =
        runTest {
            server.enqueue(MockResponse.Builder().code(204).build())
            api.registerDevice(DeviceRegistration(deviceId = "d1", fcmToken = null, appVersion = "0.0.1"))
            assertEquals(
                """{"device_id":"d1","platform":"android","fcm_token":null,"app_version":"0.0.1"}""",
                server.takeRequest().body!!.utf8(),
            )

            server.enqueue(json(201, """{"key":"images/i1/original.jpg","bytes":3}"""))
            val bytes = byteArrayOf(1, 2, 3)
            val uploaded = api.uploadBlob("i1", "original.jpg", bytes.toRequestBody("image/jpeg".toMediaType()))
            assertEquals(3L, uploaded.bytes)
            val put = server.takeRequest()
            assertEquals("PUT", put.method)
            assertEquals("/v1/images/i1/blobs/original.jpg", put.url.encodedPath)
            assertEquals("image/jpeg", put.headers["Content-Type"])
            assertEquals("3", put.headers["Content-Length"])
        }

    @Test
    fun theBaseUrlNeedsAScheme() {
        assertThrows(IllegalArgumentException::class.java) { ApiConfig("maunedas-dev.maunedas.workers.dev") }
        assertEquals("https://x.dev/", ApiConfig("https://x.dev").retrofitBaseUrl)
    }

    @Test
    fun cursorsRoundTrip() {
        val encoded = MaunedasJson.encodeToString(PullCursor.serializer(), PullCursor(3, "a"))
        assertEquals("""[3,"a"]""", encoded)
        assertEquals(PullCursor(3, "a"), MaunedasJson.decodeFromString(PullCursor.serializer(), encoded))
        assertEquals(JsonPrimitive(3L), MaunedasJson.parseToJsonElement(encoded).let { (it as kotlinx.serialization.json.JsonArray)[0] })
    }
}
