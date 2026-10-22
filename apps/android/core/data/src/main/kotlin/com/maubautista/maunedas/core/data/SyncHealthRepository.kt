package com.maubautista.maunedas.core.data

import com.maubautista.maunedas.core.database.AppDatabase
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import javax.inject.Inject
import javax.inject.Singleton

/** [pending]: local changes and photos not uploaded yet; [rejected]: changes the server refused (04 §6.5). */
data class SyncBacklog(
    val pending: Int,
    val rejected: Int,
)

@Singleton
class SyncHealthRepository
    @Inject
    constructor(
        private val db: AppDatabase,
    ) {
        fun backlog(): Flow<SyncBacklog> =
            combine(db.outbox().observeCount(), db.pendingUploads().observeCount(), db.syncIssues().observeUnresolvedCount()) { changes, uploads, issues ->
                SyncBacklog(pending = changes + uploads, rejected = issues)
            }
    }
