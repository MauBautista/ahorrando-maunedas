package com.maubautista.maunedas.feature.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.maubautista.maunedas.core.data.BarcodeConflict
import com.maubautista.maunedas.core.data.PendingTable
import com.maubautista.maunedas.core.data.RejectedChange
import com.maubautista.maunedas.core.data.SyncCenter
import com.maubautista.maunedas.core.model.Clock
import com.maubautista.maunedas.core.sync.SyncScheduler
import com.maubautista.maunedas.core.sync.SyncStatus
import com.maubautista.maunedas.core.sync.SyncStatusStore
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

/** S-16 (05 §5, RF-SYN-04). */
@HiltViewModel
class SyncStatusViewModel
    @Inject
    constructor(
        status: SyncStatusStore,
        private val center: SyncCenter,
        private val scheduler: SyncScheduler,
        private val clock: Clock,
    ) : ViewModel() {
        val sync: StateFlow<SyncStatus> = status.status
        val pending: StateFlow<List<PendingTable>> = center.pendingByTable().stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())
        val uploads: StateFlow<Int> = center.pendingUploads().stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), 0)
        val rejected: StateFlow<List<RejectedChange>> = center.rejected().stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

        fun now(): Long = clock.nowMillis()

        fun syncNow() = scheduler.syncNow()

        fun dismiss(id: Long) {
            viewModelScope.launch { center.dismiss(id) }
        }
    }

/**
 * Over every screen: the barcode conflict dialog (S-17) and "Otro dispositivo actualizó …" (04 §6.5). The dialog shows
 * the oldest conflict until someone answers it.
 */
@HiltViewModel
class SyncConflictsViewModel
    @Inject
    constructor(
        status: SyncStatusStore,
        private val center: SyncCenter,
    ) : ViewModel() {
        val conflict: StateFlow<BarcodeConflict?> = center.barcodeConflicts().map { it.lastOrNull() }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

        /** Names of rows another device changed; null when the row has no name to show. */
        val updatedElsewhere: Flow<String?> = status.events.map { center.rowName(it.table, it.rowId) }

        fun useTheirs(c: BarcodeConflict) {
            viewModelScope.launch { center.useTheirVariant(c) }
        }

        fun keepSeparate(c: BarcodeConflict) {
            viewModelScope.launch { center.keepSeparate(c) }
        }
    }
