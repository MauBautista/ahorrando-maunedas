package com.maubautista.maunedas.core.sync

import com.maubautista.maunedas.core.database.AppDatabase
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import javax.inject.Inject

/**
 * Applies pulled rows in table order (04 §6.4). A row with a pending local change that is newer than the
 * incoming one is kept: it wins when it is pushed. Runs inside the caller's transaction.
 */
class PullApplier
    @Inject
    constructor(
        private val db: AppDatabase,
        private val json: Json,
    ) {
        suspend fun apply(changes: Map<String, List<JsonObject>>) {
            for (table in SyncTables.all) {
                val rows = changes[table.name] ?: continue
                applyTable(table, rows)
            }
        }

        private suspend fun <T : Any> applyTable(
            table: SyncTable<T>,
            rows: List<JsonObject>,
        ) {
            val keep =
                rows.map { json.decodeFromJsonElement(table.serializer, it) }.filter { incoming ->
                    val updatedAt = table.updatedAt ?: return@filter true
                    if (!db.outbox().contains(table.name, table.id(incoming))) return@filter true
                    val local = table.find(db, table.id(incoming)) ?: return@filter true
                    updatedAt(local) <= updatedAt(incoming)
                }
            if (keep.isNotEmpty()) table.dao(db).upsertAll(keep)
        }
    }
