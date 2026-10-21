package com.maubautista.maunedas.core.sync

import androidx.room.withTransaction
import com.maubautista.maunedas.core.database.AppDatabase
import com.maubautista.maunedas.core.database.entity.OutboxEntry
import com.maubautista.maunedas.core.database.entity.SyncCursorEntity
import com.maubautista.maunedas.core.database.entity.SyncIssueEntity
import com.maubautista.maunedas.core.model.Clock
import com.maubautista.maunedas.core.network.ApiException
import com.maubautista.maunedas.core.network.MaunedasApi
import com.maubautista.maunedas.core.network.dto.Mutation
import com.maubautista.maunedas.core.network.dto.PullCursor
import com.maubautista.maunedas.core.network.dto.PullRequest
import com.maubautista.maunedas.core.network.dto.PushRequest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import javax.inject.Inject

/**
 * Push then pull (04 §6.3), without WorkManager so it can be tested with Room in memory and MockWebServer.
 * Network failures surface as IOException and API errors as ApiException; the worker decides about retries.
 */
class SyncEngine
    @Inject
    constructor(
        private val db: AppDatabase,
        private val api: MaunedasApi,
        private val json: Json,
        private val clock: Clock,
        private val applier: PullApplier,
        private val conflicts: ConflictHandler,
        private val deviceId: DeviceIdStore,
    ) {
        suspend fun sync() {
            pushAll()
            pullAll()
        }

        /** Everything enqueued up to now, 100 rows per request, parents first (CLAUDE.md rule 13). */
        suspend fun pushAll() {
            val snapshot = clock.nowMillis()
            while (true) {
                val batch = db.outbox().nextBatch(limit = PUSH_LIMIT, enqueuedBefore = snapshot)
                if (batch.isEmpty()) return
                pushBatch(batch)
            }
        }

        private suspend fun pushBatch(batch: List<OutboxEntry>) {
            val (mutations, missing) = load(batch)
            if (missing.isNotEmpty()) db.outbox().remove(missing.map { it.seq })
            if (mutations.isEmpty()) return
            val sent = batch - missing.toSet()
            val result =
                try {
                    api.push(PushRequest(deviceId = deviceId.get(), mutations = mutations))
                } catch (e: ApiException) {
                    if (e.code !in SPLITTABLE) throw e
                    if (sent.size == 1) {
                        // Alone and still rejected: set it aside so the rest of the queue can move.
                        val entry = sent.single()
                        db.syncIssues().add(
                            SyncIssueEntity(
                                tableName = entry.tableName,
                                rowId = entry.rowId,
                                reason = e.code,
                                detailsJson = e.details?.let { json.encodeToString(JsonObject.serializer(), it) },
                                createdAt = clock.nowMillis(),
                            ),
                        )
                        db.outbox().remove(listOf(entry.seq))
                        return
                    }
                    sent.chunked((sent.size + 1) / 2).forEach { pushBatch(it) }
                    return
                }
            conflicts.handle(result.conflicts)
            // An entry re-enqueued during the push keeps its place: that edit still has to go (04 §6.3).
            db.outbox().removeIfUnchanged(sent)
        }

        /** Current row of each entry as JSON, without `version` (only the server assigns it). */
        private suspend fun load(batch: List<OutboxEntry>): Pair<List<Mutation>, List<OutboxEntry>> {
            val mutations = mutableListOf<Mutation>()
            val missing = mutableListOf<OutboxEntry>()
            for (entry in batch) {
                val row = SyncTables.named(entry.tableName)?.let { encode(it, entry.rowId) }
                if (row == null) missing += entry else mutations += Mutation(entry.tableName, row)
            }
            return mutations to missing
        }

        private suspend fun <T : Any> encode(
            table: SyncTable<T>,
            id: String,
        ): JsonObject? {
            val row = table.find(db, id) ?: return null
            return JsonObject(json.encodeToJsonElement(table.serializer, row).jsonObject - "version")
        }

        /** Pages until no table has more rows; each page is applied with its cursors in one transaction. */
        suspend fun pullAll() {
            do {
                val cursors = db.syncCursors().all().associate { it.tableName to PullCursor(it.version, it.lastId) }
                val page = api.pull(PullRequest(cursors = cursors, limit = PULL_LIMIT))
                db.withTransaction {
                    applier.apply(page.changes)
                    db.syncCursors().saveAll(page.cursors.map { (table, c) -> SyncCursorEntity(table, c.version, c.lastId) })
                }
            } while (page.hasMore)
        }

        private companion object {
            const val PUSH_LIMIT = 100

            /** Rows per table per page: the Worker's default, near the Free CPU limit (spike D, T40). */
            const val PULL_LIMIT = 100

            /** A batch the server rejects as a whole is split until the culprit is alone (04 §6.3). */
            val SPLITTABLE = setOf("BATCH_REJECTED", "PAYLOAD_TOO_LARGE")
        }
    }
