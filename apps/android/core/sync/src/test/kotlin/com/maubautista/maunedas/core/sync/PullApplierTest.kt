package com.maubautista.maunedas.core.sync

import com.maubautista.maunedas.core.database.entity.OutboxEntry
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** 04 §8: PullApplier respects newer pending local changes (Room in memory). */
@RunWith(RobolectricTestRunner::class)
class PullApplierTest {
    private val env = TestEnv()
    private val db = env.db

    @After
    fun close() = env.close()

    private fun row(text: String): JsonObject = kotlinx.serialization.json.Json.parseToJsonElement(text).jsonObject

    private fun tagRow(
        id: String,
        name: String,
        updatedAt: Long,
        deletedAt: Long? = null,
    ) = row(
        """{"id":"$id","name":"$name","created_at":1,"updated_at":$updatedAt,"deleted_at":$deletedAt,"updated_by":null,"version":7,"new_column":"x"}""",
    )

    @Test
    fun aNewerPendingLocalChangeIsKeptAnOlderOneIsReplaced() =
        runTest {
            db.tags().upsertAll(listOf(tag("newer", "local", at = 200), tag("older", "local", at = 100), tag("clean", "local", at = 300)))
            db.outbox().enqueueAll(listOf(OutboxEntry(tableName = "tags", rowId = "newer", enqueuedAt = 1), OutboxEntry(tableName = "tags", rowId = "older", enqueuedAt = 1)))

            env.applier.apply(mapOf("tags" to listOf(tagRow("newer", "server", 150), tagRow("older", "server", 150), tagRow("clean", "server", 150))))

            assertEquals("local", db.tags().byId("newer")!!.name)
            assertEquals("server", db.tags().byId("older")!!.name)
            // Without a pending change the server always wins, even with an older updated_at.
            assertEquals("server", db.tags().byId("clean")!!.name)
            assertEquals(7L, db.tags().byId("older")!!.version)
        }

    @Test
    fun appliesNewRowsTombstonesAndDownTablesIgnoringUnknownColumns() =
        runTest {
            env.applier.apply(
                mapOf(
                    "tags" to listOf(tagRow("t1", "Básicos", 10), tagRow("t2", "Viejo", 10, deletedAt = 11)),
                    "users" to listOf(row("""{"id":"u1","username":"mau","display_name":"Mauricio","role":"admin","active":1,"updated_at":5,"version":3}""")),
                ),
            )
            assertEquals("Básicos", db.tags().byId("t1")!!.name)
            assertNotNull(db.tags().byId("t2")!!.deletedAt)
            assertEquals("Mauricio", db.users().byId("u1")!!.displayName)
        }

    @Test
    // Room has no foreign keys (04 §6.1): rows of several tables apply in any order; the 04 §6.4 order is kept anyway.
    fun rowsOfSeveralTablesApplyTogether() =
        runTest {
            val variantRow =
                row(
                    """{"id":"v1","product_id":"p1","label":"1 L","measure":"volume","unit_amount":1000,"pack_count":1,"sold_by_weight":0,
                        "primary_image_id":null,"created_at":1,"updated_at":1,"deleted_at":null,"updated_by":null,"version":1}""",
                )
            val productRow =
                row(
                    """{"id":"p1","name":"Leche","brand":null,"category_id":null,"display_unit":"L","notes":null,"primary_image_id":null,
                        "search_key":"leche","created_at":1,"updated_at":1,"deleted_at":null,"updated_by":null,"version":1}""",
                )
            env.applier.apply(linkedMapOf("variants" to listOf(variantRow), "products" to listOf(productRow)))
            assertEquals("Leche", db.products().byId("p1")!!.name)
            assertEquals("p1", db.variants().byId("v1")!!.productId)
        }
}
