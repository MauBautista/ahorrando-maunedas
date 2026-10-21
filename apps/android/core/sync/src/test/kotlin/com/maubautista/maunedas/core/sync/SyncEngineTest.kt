package com.maubautista.maunedas.core.sync

import com.maubautista.maunedas.core.database.entity.OutboxEntry
import com.maubautista.maunedas.core.network.UpgradeRequiredException
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class SyncEngineTest {
    private val server = MockWebServer()
    private lateinit var env: TestEnv
    private val pushes = mutableListOf<List<String>>()

    /** Push answers: a function of the row ids in the request. */
    private var onPush: (List<String>) -> MockResponse = { json(200, """{"applied":${it.size},"skipped":0,"conflicts":[]}""") }
    private var pulls = mutableListOf<MockResponse>()

    @Before
    fun start() {
        server.dispatcher =
            object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse =
                    when (request.url.encodedPath) {
                        "/v1/sync/push" -> {
                            val body = Json.parseToJsonElement(request.body!!.utf8()).jsonObject
                            val ids = body["mutations"]!!.jsonArray.map { it.jsonObject["row"]!!.jsonObject["id"]!!.jsonPrimitive.content }
                            pushes += ids
                            onPush(ids)
                        }
                        "/v1/sync/pull" -> pulls.removeFirstOrNull() ?: json(200, EMPTY_PULL)
                        else -> MockResponse.Builder().code(404).build()
                    }
            }
        server.start()
        env = TestEnv(server)
    }

    @After
    fun stop() {
        env.close()
        server.close()
    }

    private val engine get() = env.engine!!

    @Test
    fun pushesRowsParentsFirstWithoutVersionAndEmptiesTheQueue() =
        runTest {
            env.writer.write(SyncTables.of("variants"), listOf(variant("v1", "p1")))
            env.writer.write(SyncTables.of("products"), listOf(product("p1")))
            engine.pushAll()
            assertEquals(listOf(listOf("p1", "v1")), pushes)
            val sent = Json.parseToJsonElement(server.takeRequest().body!!.utf8()).jsonObject
            val row = sent["mutations"]!!.jsonArray[0].jsonObject["row"]!!.jsonObject
            assertFalse("version" in row)
            assertEquals("p1", row["id"]!!.jsonPrimitive.content)
            assertTrue("brand" in row)
            assertEquals(env.deviceId.get(), sent["device_id"]!!.jsonPrimitive.content)
            assertEquals(0, env.db.outbox().count())
        }

    @Test
    fun aRejectedBatchIsSplitUntilTheCulpritIsAloneAndSetAside() =
        runTest {
            onPush = { ids ->
                if ("bad" in ids) {
                    json(409, """{"error":{"code":"BATCH_REJECTED","message":"El servidor rechazó el lote.","details":{"why":"x"}}}""")
                } else {
                    json(200, """{"applied":${ids.size},"skipped":0,"conflicts":[]}""")
                }
            }
            env.writer.write(SyncTables.of("tags"), listOf(tag("t1"), tag("t2"), tag("t3"), tag("bad")))
            engine.pushAll()
            assertEquals(listOf(4, 2, 2, 1, 1), pushes.map { it.size })
            assertEquals(0, env.db.outbox().count())
            val issue = env.db.syncIssues().unresolved().single()
            assertEquals(listOf("tags", "bad", "BATCH_REJECTED"), listOf(issue.tableName, issue.rowId, issue.reason))
            assertTrue(issue.detailsJson!!.contains("why"))
        }

    @Test
    // Re-enqueuing replaces the entry (new seq) and removeIfUnchanged also checks enqueued_at: either keeps the edit.
    fun anEditDuringThePushIsNotLost() =
        runTest {
            env.writer.write(SyncTables.of("tags"), listOf(tag("t1", "antes")))
            onPush = { ids ->
                // The person edits the row while the request is in flight.
                runBlocking {
                    env.clock.now += 1_000
                    env.writer.write(SyncTables.of("tags"), listOf(tag("t1", "después")))
                }
                json(200, """{"applied":${ids.size},"skipped":0,"conflicts":[]}""")
            }
            engine.pushAll()
            assertEquals(1, pushes.size)
            assertEquals(listOf("t1"), env.db.outbox().nextBatch(10, Long.MAX_VALUE).map { it.rowId })

            onPush = { ids -> json(200, """{"applied":${ids.size},"skipped":0,"conflicts":[]}""") }
            engine.pushAll()
            assertEquals(2, pushes.size)
            assertEquals(0, env.db.outbox().count())
        }

    @Test
    fun conflictsRestoreTheServerRowOrRecordAnIssue() =
        runTest {
            env.db.products().upsertAll(listOf(product("p1")))
            env.db.variants().upsertAll(listOf(variant("v1", "p1")))
            env.writer.write(SyncTables.of("products"), listOf(product("p1").copy(name = "mío")))
            env.writer.write(SyncTables.of("barcodes"), listOf(barcode("b1", "v1")))
            env.writer.write(SyncTables.of("tags"), listOf(tag("t1")))
            val notices = mutableListOf<SyncNotice>()
            val collector = backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { env.status.events.collect { notices += it } }
            onPush = {
                json(
                    200,
                    """{"applied":0,"skipped":0,"conflicts":[
                      {"table":"products","id":"p1","reason":"STALE","server_row":{"id":"p1","name":"del otro","brand":null,"category_id":null,
                        "display_unit":"L","notes":null,"primary_image_id":null,"search_key":"del otro","created_at":1,"updated_at":99,
                        "deleted_at":null,"updated_by":"x","version":12}},
                      {"table":"barcodes","id":"b1","reason":"BARCODE_TAKEN","server_row":null,"details":{"variant_id":"v9","barcode_id":"b9"}},
                      {"table":"tags","id":"t1","reason":"VALIDATION","server_row":null,"details":{"reason":"MISSING_PARENT"}}]}""",
                )
            }
            engine.pushAll()
            testScheduler.advanceUntilIdle()
            assertEquals("del otro", env.db.products().byId("p1")!!.name)
            assertEquals(listOf(SyncNotice("products", "p1")), notices)
            assertEquals("v1", env.db.barcodes().byId("b1")!!.variantId)
            assertEquals(listOf("BARCODE_TAKEN", "VALIDATION"), env.db.syncIssues().unresolved().map { it.reason })
            assertTrue(env.db.syncIssues().unresolved().first().detailsJson!!.contains("v9"))
            assertEquals(0, env.db.outbox().count())
            collector.cancel()
        }

    @Test
    fun anEntryWhoseRowNoLongerExistsIsDroppedWithoutARequest() =
        runTest {
            env.db.outbox().enqueueAll(listOf(OutboxEntry(tableName = "tags", rowId = "ghost", enqueuedAt = 1)))
            engine.pushAll()
            assertEquals(emptyList<List<String>>(), pushes)
            assertEquals(0, env.db.outbox().count())
        }

    @Test
    fun pullsPagesUntilDoneSavingTheCursors() =
        runTest {
            pulls +=
                json(
                    200,
                    """{"changes":{"tags":[{"id":"t1","name":"uno","created_at":1,"updated_at":1,"deleted_at":null,"updated_by":null,"version":5}]},
                        "cursors":{"tags":[5,"t1"],"stores":[0,""]},"has_more":true,"server_time":1,"schema_version":1}""",
                )
            pulls +=
                json(
                    200,
                    """{"changes":{"tags":[{"id":"t2","name":"dos","created_at":1,"updated_at":1,"deleted_at":null,"updated_by":null,"version":6}]},
                        "cursors":{"tags":[6,"t2"],"stores":[0,""]},"has_more":false,"server_time":1,"schema_version":1}""",
                )
            engine.pullAll()
            assertEquals(listOf("uno", "dos"), listOf("t1", "t2").map { env.db.tags().byId(it)!!.name })
            val requests = (1..2).map { Json.parseToJsonElement(server.takeRequest().body!!.utf8()).jsonObject }
            assertEquals("{}", requests[0]["cursors"].toString())
            assertEquals("""[5,"t1"]""", requests[1]["cursors"]!!.jsonObject["tags"].toString())
            assertEquals(100, requests[0]["limit"]!!.jsonPrimitive.content.toInt())
            assertEquals(6L, env.db.syncCursors().all().single { it.tableName == "tags" }.version)
        }

    @Test
    fun anOldAppGetsUpgradeRequired() =
        runTest {
            pulls += json(426, """{"error":{"code":"UPGRADE_REQUIRED","message":"Actualiza la app."}}""")
            assertThrows(UpgradeRequiredException::class.java) { runBlocking { engine.pullAll() } }
        }

}
