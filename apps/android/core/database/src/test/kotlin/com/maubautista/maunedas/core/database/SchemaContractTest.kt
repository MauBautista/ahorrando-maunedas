package com.maubautista.maunedas.core.database

import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** Room mirrors exactly the tables of packages/shared/sync-schema.json (04 §6.1, T-102). */
@RunWith(RobolectricTestRunner::class)
class SchemaContractTest {
    private val db = inMemoryDb()
    private val contract = json("contracts/sync-schema.json")["tables"]!!.jsonArray.map { it.jsonObject }

    @After
    fun close() = db.close()

    @Test
    fun everyMirroredTableHasTheColumnsTypesAndNullabilityOfTheContract() {
        val failures =
            contract.mapNotNull { table ->
                val name = table["name"]!!.jsonPrimitive.content
                val expected =
                    table["columns"]!!.jsonArray.map { c ->
                        val o = c.jsonObject
                        Triple(o["name"]!!.jsonPrimitive.content, o["type"]!!.jsonPrimitive.content, o["not_null"]!!.jsonPrimitive.boolean)
                    }
                val actual =
                    db.rows("SELECT name, type, \"notnull\" FROM pragma_table_info('$name')").map {
                        Triple(it["name"] as String, it["type"] as String, it["notnull"] == 1L)
                    }
                val pk = db.rows("SELECT name FROM pragma_table_info('$name') WHERE pk = 1").map { it["name"] }
                when {
                    actual != expected -> "$name:\n  contrato $expected\n  Room     $actual"
                    pk != listOf(table["pk"]!!.jsonPrimitive.content) -> "$name: llave $pk"
                    else -> null
                }
            }
        if (failures.isNotEmpty()) throw AssertionError(failures.joinToString("\n"))
    }

    @Test
    fun onlyTheContractTablesAndTheLocalOnesExist() {
        val tables =
            db.rows("SELECT name FROM sqlite_master WHERE type = 'table'")
                .map { it["name"] as String }
                .filterNot { it in setOf("room_master_table", "android_metadata", "sqlite_sequence") }
                .sorted()
        val expected = (contract.map { it["name"]!!.jsonPrimitive.content } + LOCAL_TABLES).sorted()
        assertEquals(expected, tables)
    }

    private companion object {
        val LOCAL_TABLES = listOf("outbox", "pending_uploads", "sync_cursors", "sync_issues")
    }
}
