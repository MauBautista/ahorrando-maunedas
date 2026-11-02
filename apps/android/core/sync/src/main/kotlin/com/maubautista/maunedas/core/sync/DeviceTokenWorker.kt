package com.maubautista.maunedas.core.sync

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.maubautista.maunedas.core.model.CurrentUser
import com.maubautista.maunedas.core.network.ApiException
import com.maubautista.maunedas.core.network.ClientInfo
import com.maubautista.maunedas.core.network.MaunedasApi
import com.maubautista.maunedas.core.network.dto.DeviceRegistration
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import java.io.IOException

/**
 * Sends this device's FCM token to the Worker (`POST /v1/devices`, 08 §6), so alerts reach the phone. Only a token
 * the Worker has not accepted yet is sent; without a session there is nothing to register.
 */
@HiltWorker
class DeviceTokenWorker
    @AssistedInject
    constructor(
        @Assisted context: Context,
        @Assisted params: WorkerParameters,
        private val user: CurrentUser,
        private val api: MaunedasApi,
        private val deviceId: DeviceIdStore,
        private val client: ClientInfo,
    ) : CoroutineWorker(context, params) {
        override suspend fun doWork(): Result {
            val token = inputData.getString(TOKEN) ?: return Result.failure()
            if (user.id() == null || deviceId.registeredToken() == token) return Result.success()
            return try {
                api.registerDevice(DeviceRegistration(deviceId = deviceId.get(), fcmToken = token, appVersion = client.appVersion))
                deviceId.saveRegisteredToken(token)
                Result.success()
            } catch (e: IOException) {
                Result.retry()
            } catch (e: ApiException) {
                if (e.status >= 500) Result.retry() else Result.failure()
            }
        }

        companion object {
            const val TOKEN = "fcm_token"
        }
    }
