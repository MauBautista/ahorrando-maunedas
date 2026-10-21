package com.maubautista.maunedas.core.sync

import com.maubautista.maunedas.core.database.AppDatabase
import com.maubautista.maunedas.core.database.entity.SyncIssueEntity
import com.maubautista.maunedas.core.model.Clock
import com.maubautista.maunedas.core.network.dto.PushConflict
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import javax.inject.Inject

/** Push conflicts (04 §6.5): what the server keeps replaces the local row; what needs a person is recorded. */
class ConflictHandler
    @Inject
    constructor(
        private val db: AppDatabase,
        private val json: Json,
        private val clock: Clock,
        private val status: SyncStatusStore,
    ) {
        suspend fun handle(conflicts: List<PushConflict>) {
            for (c in conflicts) {
                when (c.reason) {
                    "STALE" -> {
                        restore(c)
                        if (c.table in VISIBLE) status.notice(SyncNotice(c.table, c.id))
                    }
                    "ALIAS_TAKEN" -> restore(c)
                    // The person decides: use that variant or keep mine separate (04 §6.5).
                    "BARCODE_TAKEN" -> issue(c)
                    else -> {
                        restore(c)
                        issue(c)
                    }
                }
            }
        }

        /** Replaces the local row by the server's, without enqueuing it again. */
        private suspend fun restore(c: PushConflict) {
            val row = c.serverRow ?: return
            val table = SyncTables.named(c.table) ?: return
            upsert(table, row)
        }

        private suspend fun <T : Any> upsert(
            table: SyncTable<T>,
            row: JsonObject,
        ) = table.dao(db).upsertAll(listOf(json.decodeFromJsonElement(table.serializer, row)))

        private suspend fun issue(c: PushConflict) {
            val details =
                buildJsonObject {
                    c.details?.let { put("details", it) }
                    c.serverRow?.let { put("server_row", it) }
                }
            db.syncIssues().add(
                SyncIssueEntity(
                    tableName = c.table,
                    rowId = c.id,
                    reason = c.reason,
                    detailsJson = json.encodeToString(JsonObject.serializer(), details),
                    createdAt = clock.nowMillis(),
                ),
            )
        }

        private companion object {
            /** Tables whose rows the family sees by name (04 §6.5). */
            val VISIBLE = setOf("purchases", "products", "variants")
        }
    }
