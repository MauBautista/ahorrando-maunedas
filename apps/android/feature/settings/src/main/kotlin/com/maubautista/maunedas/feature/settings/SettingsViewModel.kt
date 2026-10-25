package com.maubautista.maunedas.feature.settings

import androidx.annotation.StringRes
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.maubautista.maunedas.core.auth.AuthService
import com.maubautista.maunedas.core.auth.MIN_PASSWORD
import com.maubautista.maunedas.core.auth.PasswordChange
import com.maubautista.maunedas.core.auth.SessionStore
import com.maubautista.maunedas.core.auth.SessionUser
import com.maubautista.maunedas.core.data.SyncCenter
import com.maubautista.maunedas.core.data.SyncHealthRepository
import com.maubautista.maunedas.core.network.ClientInfo
import com.maubautista.maunedas.core.sync.SyncScheduler
import com.maubautista.maunedas.core.sync.SyncStatus
import com.maubautista.maunedas.core.sync.SyncStatusStore
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/** The password dialog of S-15 (RF-AUTH-06). */
data class PasswordForm(
    val current: String = "",
    val new: String = "",
    val repeat: String = "",
    @StringRes val error: Int? = null,
    val busy: Boolean = false,
) {
    /** What is wrong before asking Firebase, or null. */
    @StringRes
    fun problem(): Int? =
        when {
            new.length < MIN_PASSWORD -> R.string.settings_password_short
            new != repeat -> R.string.settings_password_mismatch
            else -> null
        }
}

/** S-15 (05 §5): account, sync summary, local photos, version, sign out (02 §6.4). */
@HiltViewModel
class SettingsViewModel
    @Inject
    constructor(
        session: SessionStore,
        status: SyncStatusStore,
        health: SyncHealthRepository,
        private val center: SyncCenter,
        private val auth: AuthService,
        private val scheduler: SyncScheduler,
        val client: ClientInfo,
    ) : ViewModel() {
        val user: StateFlow<SessionUser?> = session.user

        /** RF-AUTH-06 only for a session that signed in with username and password (T76). */
        val canChangePassword: Boolean get() = auth.signedInWithPassword()
        val sync: StateFlow<SyncStatus> = status.status
        val pending: StateFlow<Int> = health.backlog().map { it.pending }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), 0)

        private val photos = MutableStateFlow<Long?>(null)
        val photosBytes: StateFlow<Long?> = photos.asStateFlow()

        private val messageState = MutableStateFlow<Message?>(null)
        val message: StateFlow<Message?> = messageState.asStateFlow()

        private val passwordState = MutableStateFlow<PasswordForm?>(null)
        val password: StateFlow<PasswordForm?> = passwordState.asStateFlow()

        /** Pending changes when sign-out was asked; null = no dialog. Zero signs out without asking. */
        private val confirm = MutableStateFlow<Int?>(null)
        val confirmSignOut: StateFlow<Int?> = confirm.asStateFlow()

        private val out = Channel<Unit>(Channel.BUFFERED)
        val signedOut = out.receiveAsFlow()

        init {
            refreshPhotos()
        }

        fun syncNow() = scheduler.syncNow()

        fun refreshPhotos() {
            viewModelScope.launch { photos.value = center.localPhotosBytes() }
        }

        fun freeSpace() {
            viewModelScope.launch {
                val freed = center.freeSpace()
                photos.value = center.localPhotosBytes()
                messageState.value = Message.Freed(freed)
            }
        }

        fun dismissMessage() {
            messageState.value = null
        }

        fun openPassword() {
            passwordState.value = PasswordForm()
        }

        fun onPassword(change: (PasswordForm) -> PasswordForm) = passwordState.update { it?.let(change)?.copy(error = null) }

        fun closePassword() {
            passwordState.value = null
        }

        fun changePassword() {
            val form = passwordState.value ?: return
            if (form.busy) return
            form.problem()?.let { p ->
                passwordState.value = form.copy(error = p)
                return
            }
            passwordState.value = form.copy(busy = true)
            viewModelScope.launch {
                when (auth.changePassword(form.current, form.new)) {
                    PasswordChange.DONE -> {
                        passwordState.value = null
                        messageState.value = Message.Text(R.string.settings_password_done)
                    }
                    PasswordChange.WRONG_CURRENT -> passwordState.update { it?.copy(busy = false, error = R.string.settings_password_wrong) }
                    PasswordChange.WEAK -> passwordState.update { it?.copy(busy = false, error = R.string.settings_password_weak) }
                    PasswordChange.NO_NETWORK -> passwordState.update { it?.copy(busy = false, error = R.string.settings_password_no_network) }
                    PasswordChange.FAILED -> passwordState.update { it?.copy(busy = false, error = R.string.settings_password_failed) }
                }
            }
        }

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

        /** A one-time message of S-15. */
        sealed interface Message {
            data class Text(
                @StringRes val text: Int,
            ) : Message

            data class Freed(
                val bytes: Long,
            ) : Message
        }
    }
