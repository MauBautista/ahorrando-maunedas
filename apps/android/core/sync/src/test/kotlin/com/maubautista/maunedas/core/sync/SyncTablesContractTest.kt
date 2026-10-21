package com.maubautista.maunedas.core.sync

import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** SyncTables is the registry of packages/shared (name, mode, order), through sync-schema.json. */
@RunWith(RobolectricTestRunner::class)
class SyncTablesContractTest {
    @Test
    fun sameTablesModesAndOrderAsTheRegistry() {
        val url = SyncTables::class.java.getResource("/contracts/sync-schema.json")!!
        val contract =
            Json.parseToJsonElement(url.readText()).jsonObject["tables"]!!.jsonArray.map {
                val t = it.jsonObject
                Triple(t["name"]!!.jsonPrimitive.content, t["mode"]!!.jsonPrimitive.content.uppercase(), t["order"]!!.jsonPrimitive.int)
            }
        assertEquals(contract, SyncTables.all.map { Triple(it.name, it.mode.name, it.order) })
    }

    @Test
    fun everyTableReachesItsDao() =
        runTest {
            val env = TestEnv()
            for (table in SyncTables.all) assertNull(table.name, table.find(env.db, "missing"))
            env.close()
        }
}
