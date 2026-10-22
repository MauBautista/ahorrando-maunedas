package com.maubautista.maunedas.feature.auth

import android.app.Activity
import androidx.annotation.StringRes
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.maubautista.maunedas.core.auth.AuthService
import com.maubautista.maunedas.core.auth.LoginResult
import com.maubautista.maunedas.core.sync.SyncScheduler
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class LoginUiState(
    val username: String = "",
    val password: String = "",
    val busy: Boolean = false,
    @StringRes val error: Int? = null,
)

/** After a successful login the app starts syncing and goes home (02 §6, 04 §6.6). */
fun interface SyncStarter {
    fun start()
}

@HiltViewModel
class LoginViewModel
    @Inject
    constructor(
        private val auth: AuthService,
        private val sync: SyncStarter,
    ) : ViewModel() {
        private val ui = MutableStateFlow(LoginUiState())
        val state: StateFlow<LoginUiState> = ui.asStateFlow()

        private val done = Channel<Unit>(Channel.BUFFERED)

        /** One event per successful login. */
        val signedIn = done.receiveAsFlow()

        fun onUsernameChange(value: String) = ui.update { it.copy(username = value, error = null) }

        fun onPasswordChange(value: String) = ui.update { it.copy(password = value, error = null) }

        fun signInWithPassword() {
            val s = ui.value
            if (s.busy) return
            if (s.username.isBlank() || s.password.isEmpty()) {
                ui.update { it.copy(error = R.string.auth_error_empty) }
                return
            }
            run { auth.signInWithPassword(s.username, s.password) }
        }

        fun signInWithGoogle(activity: Activity) {
            if (ui.value.busy) return
            run { auth.signInWithGoogle(activity) }
        }

        private fun run(block: suspend () -> LoginResult) {
            ui.update { it.copy(busy = true, error = null) }
            viewModelScope.launch {
                val result = block()
                ui.update { it.copy(busy = false, error = messageOf(result), password = if (result is LoginResult.Success) "" else it.password) }
                if (result is LoginResult.Success) {
                    sync.start()
                    done.send(Unit)
                }
            }
        }

        companion object {
            /** 02 §8; a cancelled Google sheet is not an error. */
            @StringRes
            fun messageOf(result: LoginResult): Int? =
                when (result) {
                    is LoginResult.Success, LoginResult.Cancelled -> null
                    LoginResult.InvalidCredentials -> R.string.auth_error_invalid
                    LoginResult.NotAllowed -> R.string.auth_error_not_allowed
                    LoginResult.Disabled -> R.string.auth_error_disabled
                    LoginResult.NoNetwork -> R.string.auth_error_no_network
                    is LoginResult.Error -> R.string.auth_error_other
                }
        }
    }

/** Sync after login: the periodic job plus one right away, so Room fills before the first screen. */
class SchedulerSyncStarter
    @Inject
    constructor(
        private val scheduler: SyncScheduler,
    ) : SyncStarter {
        override fun start() {
            scheduler.schedulePeriodic()
            scheduler.syncNow()
        }
    }
