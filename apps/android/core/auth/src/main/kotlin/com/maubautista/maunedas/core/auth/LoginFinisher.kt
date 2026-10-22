package com.maubautista.maunedas.core.auth

import com.maubautista.maunedas.core.network.ApiException
import com.maubautista.maunedas.core.network.ClientInfo
import com.maubautista.maunedas.core.network.MaunedasApi
import com.maubautista.maunedas.core.network.dto.DeviceRegistration
import com.maubautista.maunedas.core.sync.DeviceIdStore
import java.io.IOException
import javax.inject.Inject

sealed interface LoginResult {
    data class Success(val user: SessionUser) : LoginResult

    data object InvalidCredentials : LoginResult

    /** A Google account the household has not registered. */
    data object NotAllowed : LoginResult

    data object Disabled : LoginResult

    /** The first sign-in needs network (02 §8). */
    data object NoNetwork : LoginResult

    data object Cancelled : LoginResult

    data class Error(val cause: Throwable) : LoginResult
}

/**
 * What follows a Firebase sign-in (02 §6.2): the Worker decides who enters (`GET /v1/me`); then the session is
 * saved and the device registered. A 403 signs Firebase out again.
 */
class LoginFinisher
    @Inject
    constructor(
        private val api: MaunedasApi,
        private val session: SessionStore,
        private val deviceId: DeviceIdStore,
        private val client: ClientInfo,
    ) {
        suspend fun finish(signOutOfFirebase: suspend () -> Unit): LoginResult =
            try {
                val me = api.me().user
                session.save(me)
                // FCM tokens arrive with the alerts (E2); the device is known from the first login.
                api.registerDevice(DeviceRegistration(deviceId = deviceId.get(), fcmToken = null, appVersion = client.appVersion))
                LoginResult.Success(SessionUser(me.id, me.username, me.displayName, me.role, me.hasGoogle))
            } catch (e: ApiException) {
                signOutOfFirebase()
                when (e.code) {
                    "USER_NOT_ALLOWED" -> LoginResult.NotAllowed
                    "USER_DISABLED" -> LoginResult.Disabled
                    else -> LoginResult.Error(e)
                }
            } catch (e: IOException) {
                signOutOfFirebase()
                LoginResult.NoNetwork
            }
    }
