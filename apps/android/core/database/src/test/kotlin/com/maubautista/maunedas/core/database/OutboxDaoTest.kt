package com.maubautista.maunedas.core.database

import com.maubautista.maunedas.core.database.entity.OutboxEntry
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class OutboxDaoTest {
    private val db = inMemoryDb()
    private val outbox = db.outbox()

    @After
    fun close() = db.close()

    @Test
    fun batchesGoParentsFirstFollowingTheRegistryOrder() =
        runTest {
            val order =
                json("contracts/sync-schema.json")["tables"]!!.jsonArray.map { it.jsonObject }
                    .filter { it["mode"]!!.jsonPrimitive.content == "sync" }
                    .associate { it["name"]!!.jsonPrimitive.content to it["order"]!!.jsonPrimitive.int }
            // Enqueued children first, so only the ORDER BY can put the parents ahead.
            outbox.enqueueAll(order.keys.reversed().mapIndexed { i, table -> OutboxEntry(tableName = table, rowId = "r$i", enqueuedAt = 10) })
            val batch = outbox.nextBatch(limit = 100, enqueuedBefore = 10).map { it.tableName }
            assertEquals(order.size, batch.size)
            assertEquals(batch.sortedBy { order.getValue(it) }.map { order.getValue(it) }, batch.map { order.getValue(it) })
        }

    @Test
    fun reEditingCoalescesAndIsNotRemovedByAnOldPush() =
        runTest {
            outbox.enqueueAll(listOf(OutboxEntry(tableName = "products", rowId = "p1", enqueuedAt = 10)))
            val pushed = outbox.nextBatch(limit = 100, enqueuedBefore = 10)
            // Edited again while the push was in flight.
            outbox.enqueueAll(listOf(OutboxEntry(tableName = "products", rowId = "p1", enqueuedAt = 20)))
            assertEquals(1, outbox.count())
            outbox.removeIfUnchanged(pushed)
            assertEquals(listOf(20L), outbox.nextBatch(limit = 100, enqueuedBefore = 30).map { it.enqueuedAt })
            outbox.removeIfUnchanged(outbox.nextBatch(limit = 100, enqueuedBefore = 30))
            assertEquals(0, outbox.count())
        }

    @Test
    fun onlyEntriesEnqueuedBeforeTheSnapshotAndUpToTheLimit() =
        runTest {
            outbox.enqueueAll((1..5).map { OutboxEntry(tableName = "tags", rowId = "t$it", enqueuedAt = it.toLong()) })
            assertEquals(listOf("t1", "t2", "t3"), outbox.nextBatch(limit = 10, enqueuedBefore = 3).map { it.rowId })
            assertEquals(2, outbox.nextBatch(limit = 2, enqueuedBefore = 5).size)
        }
}
