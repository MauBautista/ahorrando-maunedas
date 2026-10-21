package com.maubautista.maunedas.core.sync

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/** Last sync outcome for the UI (settings, banners). Kept in memory: a new process syncs again anyway. */
sealed interface SyncStatus {
    data object Idle : SyncStatus

    data class Synced(val at: Long) : SyncStatus

    data class Failed(val at: Long, val reason: String) : SyncStatus

    /** The server needs a newer app (04 §5); local changes wait in the outbox. */
    data object UpgradeRequired : SyncStatus
}

/** A change made on another device won over a local one (04 §6.5): "Otro dispositivo actualizó …". */
data class SyncNotice(val table: String, val rowId: String)

@Singleton
class SyncStatusStore
    @Inject
    constructor() {
        private val state = MutableStateFlow<SyncStatus>(SyncStatus.Idle)
        private val notices = MutableSharedFlow<SyncNotice>(extraBufferCapacity = 32)

        val status: StateFlow<SyncStatus> = state.asStateFlow()
        val events: SharedFlow<SyncNotice> = notices.asSharedFlow()

        fun set(value: SyncStatus) {
            state.value = value
        }

        fun notice(value: SyncNotice) {
            notices.tryEmit(value)
        }
    }
