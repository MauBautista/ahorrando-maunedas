package com.maubautista.maunedas.core.sync

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import android.content.Context
import androidx.core.content.edit
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/** Last sync outcome for the UI (settings, banners). Only the time of the last success outlives the process (S-16). */
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
    constructor(
        @ApplicationContext context: Context,
    ) {
        private val prefs = context.getSharedPreferences("sync_status", Context.MODE_PRIVATE)
        private val state = MutableStateFlow(prefs.getLong(LAST_SYNCED, 0).takeIf { it > 0 }?.let { SyncStatus.Synced(it) } ?: SyncStatus.Idle)
        private val notices = MutableSharedFlow<SyncNotice>(extraBufferCapacity = 32)

        val status: StateFlow<SyncStatus> = state.asStateFlow()
        val events: SharedFlow<SyncNotice> = notices.asSharedFlow()

        fun set(value: SyncStatus) {
            state.value = value
            if (value is SyncStatus.Synced) prefs.edit { putLong(LAST_SYNCED, value.at) }
        }

        /** Signing out forgets the previous person's last sync. */
        fun clear() {
            prefs.edit { clear() }
            state.value = SyncStatus.Idle
        }

        private companion object {
            const val LAST_SYNCED = "last_synced_at"
        }

        fun notice(value: SyncNotice) {
            notices.tryEmit(value)
        }
    }
