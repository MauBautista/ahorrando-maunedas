package com.maubautista.maunedas.core.database

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject

internal fun inMemoryDb(): AppDatabase =
    Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext<Context>(), AppDatabase::class.java)
        .allowMainThreadQueries()
        .build()

/** Test resources copied by `copyFixtures`: `fixtures/…` and `contracts/…`. */
internal fun resource(path: String): String =
    (AppDatabase::class.java.getResource("/$path") ?: error("Falta $path en los recursos de prueba")).readText()

internal fun json(path: String): JsonObject = Json.parseToJsonElement(resource(path)).jsonObject

/** Rows of a query as maps of column → value (String, Long, Double or null). */
internal fun AppDatabase.rows(sql: String): List<Map<String, Any?>> {
    val out = mutableListOf<Map<String, Any?>>()
    openHelper.writableDatabase.query(sql).use { c ->
        while (c.moveToNext()) {
            out +=
                (0 until c.columnCount).associate { i ->
                    c.getColumnName(i) to
                        when (c.getType(i)) {
                            android.database.Cursor.FIELD_TYPE_NULL -> null
                            android.database.Cursor.FIELD_TYPE_INTEGER -> c.getLong(i)
                            android.database.Cursor.FIELD_TYPE_FLOAT -> c.getDouble(i)
                            else -> c.getString(i)
                        }
                }
        }
    }
    return out
}
