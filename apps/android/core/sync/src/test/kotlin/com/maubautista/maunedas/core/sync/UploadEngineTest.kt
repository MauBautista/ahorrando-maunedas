package com.maubautista.maunedas.core.sync

import com.maubautista.maunedas.core.database.entity.ImageEntity
import com.maubautista.maunedas.core.database.entity.ImageRenditionEntity
import com.maubautista.maunedas.core.database.entity.OutboxEntry
import kotlinx.coroutines.test.runTest
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File
import java.io.IOException

/** 10 §7 (Android): UploadWorker waits for the row to leave the outbox; 409 retries; 201 cleans up. */
@RunWith(RobolectricTestRunner::class)
class UploadEngineTest {
    private val server = MockWebServer()
    private lateinit var env: TestEnv
    private lateinit var queue: UploadQueue
    private var requested = 0

    @Before
    fun start() {
        server.start()
        env = TestEnv(server)
        queue = UploadQueue(env.db, env.clock) { requested++ }
    }

    @After
    fun stop() {
        env.close()
        server.close()
    }

    private val engine get() = env.uploads!!

    private fun photo(bytes: ByteArray = byteArrayOf(1, 2, 3)): File =
        File.createTempFile("original", ".jpg", env.context.cacheDir).apply { writeBytes(bytes) }

    private suspend fun image(id: String) =
        env.writer.write(
            SyncTables.of("images"),
            listOf(ImageEntity(id = id, ownerType = "product", ownerId = "p", role = "catalog", source = "user", originalKey = "images/$id/original.jpg", createdAt = 1, updatedAt = 1)),
        )

    private fun created(bytes: Int) = json(201, """{"key":"k","bytes":$bytes}""")

    @Test
    fun waitsWhileTheImageRowIsInTheOutboxThenUploadsAndKeepsTheLocalFile() =
        runTest {
            image("i1")
            val file = photo()
            queue.enqueueBlob("i1", "original.jpg", file.path)
            assertEquals(1, requested)

            assertEquals(UploadEngine.Outcome(uploaded = 0, waitingForSync = 1, toRetry = 0), engine.uploadAll())
            assertEquals(0, server.requestCount)

            env.db.outbox().removeIfUnchanged(env.db.outbox().nextBatch(10, Long.MAX_VALUE))
            server.enqueue(created(3))
            assertEquals(UploadEngine.Outcome(uploaded = 1, waitingForSync = 0, toRetry = 0), engine.uploadAll())
            val put = server.takeRequest()
            assertEquals("PUT", put.method)
            assertEquals("/v1/images/i1/blobs/original.jpg", put.url.encodedPath)
            assertEquals("image/jpeg", put.headers["Content-Type"])
            assertEquals("3", put.headers["Content-Length"])
            assertEquals(0, env.db.pendingUploads().count())
            assertTrue(file.exists())
        }

    @Test
    fun aRenditionWaitsForItsOwnRow() =
        runTest {
            env.db.outbox().enqueueAll(listOf(OutboxEntry(tableName = "image_renditions", rowId = "r1", enqueuedAt = 1)))
            env.db.imageRenditions().upsertAll(listOf(ImageRenditionEntity(id = "r1", imageId = "i1", kind = "thumb", tier = "device", r2Key = "images/i1/r1.webp", createdAt = 1, updatedAt = 1)))
            queue.enqueueBlob("i1", "r1.webp", photo().path)
            assertEquals(1, engine.uploadAll().waitingForSync)
            assertEquals(0, server.requestCount)
        }

    @Test
    fun imageNotFoundIsRetriedLaterAndTheQueueKeepsTheUpload() =
        runTest {
            queue.enqueueBlob("i1", "original.jpg", photo().path)
            server.enqueue(json(409, """{"error":{"code":"IMAGE_NOT_FOUND","message":"La imagen todavía no está registrada en el servidor."}}"""))
            assertEquals(1, engine.uploadAll().toRetry)
            val pending = env.db.pendingUploads().next(10).single()
            assertEquals(1, pending.attempts)
            assertEquals("IMAGE_NOT_FOUND", pending.lastError)

            server.enqueue(created(3))
            assertEquals(1, engine.uploadAll().uploaded)
            assertEquals(0, env.db.pendingUploads().count())
        }

    @Test
    fun tooLargeOrWrongTypeAreDroppedAsIssues() =
        runTest {
            queue.enqueueBlob("i1", "original.jpg", photo().path)
            queue.enqueueBlob("i2", "original.png", photo().path)
            server.enqueue(json(413, """{"error":{"code":"PAYLOAD_TOO_LARGE","message":"x"}}"""))
            server.enqueue(json(415, """{"error":{"code":"UNSUPPORTED_MEDIA_TYPE","message":"x"}}"""))
            assertEquals(UploadEngine.Outcome(0, 0, 0), engine.uploadAll())
            assertEquals(0, env.db.pendingUploads().count())
            assertEquals(
                listOf("i1/original.jpg" to "PAYLOAD_TOO_LARGE", "i2/original.png" to "UNSUPPORTED_MEDIA_TYPE"),
                env.db.syncIssues().unresolved().map { it.rowId to it.reason },
            )
            assertEquals("image/png", server.takeRequest().let { server.takeRequest() }.headers["Content-Type"])
        }

    @Test
    fun aMissingLocalFileIsAnIssueWithoutARequest() =
        runTest {
            queue.enqueueBlob("i1", "original.jpg", "/nowhere/original.jpg")
            engine.uploadAll()
            assertEquals(0, server.requestCount)
            assertEquals("LOCAL_FILE_MISSING", env.db.syncIssues().unresolved().single().reason)
        }

    @Test
    fun catalogImportsAndARejectedHost() =
        runTest {
            queue.enqueueImport("i1", "original.jpg", "https://images.openfoodfacts.org/x.jpg")
            queue.enqueueImport("i2", "original.jpg", "https://evil.example/x.jpg")
            server.enqueue(created(81234))
            server.enqueue(json(400, """{"error":{"code":"VALIDATION_ERROR","message":"x","details":{"reason":"HOST_NOT_ALLOWED"}}}"""))
            assertEquals(1, engine.uploadAll().uploaded)
            val first = server.takeRequest()
            assertEquals("/v1/images/i1/import", first.url.encodedPath)
            assertEquals("""{"source_url":"https://images.openfoodfacts.org/x.jpg"}""", first.body!!.utf8())
            val issue = env.db.syncIssues().unresolved().single()
            assertEquals("VALIDATION_ERROR", issue.reason)
            assertTrue(issue.detailsJson!!.contains("HOST_NOT_ALLOWED"))
        }

    @Test
    fun theSameBlobIsQueuedOnceAndANetworkFailureStopsTheRun() =
        runTest {
            queue.enqueueBlob("i1", "original.jpg", photo().path)
            queue.enqueueBlob("i1", "original.jpg", photo().path)
            assertEquals(1, env.db.pendingUploads().count())
            server.close()
            assertThrows(IOException::class.java) { kotlinx.coroutines.runBlocking { engine.uploadAll() } }
            assertEquals(1, env.db.pendingUploads().count())
        }

    @Test
    fun anExpiredSessionDoesNotLoseTheUpload() =
        runTest {
            queue.enqueueBlob("i1", "original.jpg", photo().path)
            repeat(2) { server.enqueue(json(401, """{"error":{"code":"INVALID_TOKEN","message":"x"}}""")) }
            assertEquals(1, engine.uploadAll().toRetry)
            assertEquals(1, env.db.pendingUploads().count())
        }

    @Test
    fun contentTypes() {
        assertEquals(listOf("image/jpeg", "image/png", "image/webp"), listOf("original.jpg", "a.png", "b.webp").map(UploadEngine::contentTypeOf))
    }
}
