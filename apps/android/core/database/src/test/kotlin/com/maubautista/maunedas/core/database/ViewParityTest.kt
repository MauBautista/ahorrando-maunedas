package com.maubautista.maunedas.core.database

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** The Room view `v_price_points` is the SQL of docs/esquema-d1.sql, not a copy that can drift (04 §6.1). */
@RunWith(RobolectricTestRunner::class)
class ViewParityTest {
    private val db = inMemoryDb()

    @After
    fun close() = db.close()

    private fun normalize(sql: String) = sql.replace(Regex("--[^\n]*"), " ").replace(Regex("\\s+"), " ").trim()

    @Test
    fun sameSqlAsTheDesignSchema() {
        val design =
            Regex("CREATE VIEW v_price_points AS\n(.*?);", RegexOption.DOT_MATCHES_ALL)
                .find(resource("contracts/esquema-d1.sql"))
                ?.groupValues
                ?.get(1) ?: error("esquema-d1.sql no define v_price_points")
        val room = db.rows("SELECT sql FROM sqlite_master WHERE type = 'view' AND name = 'v_price_points'").single()["sql"] as String
        assertEquals(normalize(design), normalize(room.substringAfter("CREATE VIEW `v_price_points` AS")))
    }
}
