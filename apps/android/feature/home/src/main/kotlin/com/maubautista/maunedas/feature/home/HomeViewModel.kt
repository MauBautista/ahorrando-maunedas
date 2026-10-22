package com.maubautista.maunedas.feature.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.maubautista.maunedas.core.auth.AuthService
import com.maubautista.maunedas.core.auth.SessionStore
import com.maubautista.maunedas.core.auth.SessionUser
import com.maubautista.maunedas.core.sync.SyncScheduler
import com.maubautista.maunedas.core.sync.SyncStatus
import com.maubautista.maunedas.core.sync.SyncStatusStore
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/** Provisional home (S-02 is T-111): who is signed in, sync status, sync now and sign out (02 §6.4). */
@HiltViewModel
class HomeViewModel
    @Inject
    constructor(
        session: SessionStore,
        status: SyncStatusStore,
        private val auth: AuthService,
        private val scheduler: SyncScheduler,
    ) : ViewModel() {
        val user: StateFlow<SessionUser?> = session.user
        val sync: StateFlow<SyncStatus> = status.status

        /** Pending changes when sign-out was asked; null = no dialog. Zero signs out without asking. */
        private val confirm = MutableStateFlow<Int?>(null)
        val confirmSignOut: StateFlow<Int?> = confirm.asStateFlow()

        private val out = Channel<Unit>(Channel.BUFFERED)
        val signedOut = out.receiveAsFlow()

        fun syncNow() = scheduler.syncNow()

        fun askSignOut() {
            viewModelScope.launch {
                val pending = auth.pendingChanges()
                if (pending == 0) signOut() else confirm.value = pending
            }
        }

        fun dismissSignOut() {
            confirm.value = null
        }

        fun signOut() {
            confirm.value = null
            viewModelScope.launch {
                auth.signOut()
                out.send(Unit)
            }
        }
    }
