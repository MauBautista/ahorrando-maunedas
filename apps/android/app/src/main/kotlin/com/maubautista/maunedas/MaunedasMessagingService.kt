package com.maubautista.maunedas

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.maubautista.maunedas.core.sync.SyncScheduler
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

/** FCM (08 §7): a new token goes to the Worker by a worker; data messages become notifications. */
@AndroidEntryPoint
class MaunedasMessagingService : FirebaseMessagingService() {
    @Inject lateinit var scheduler: SyncScheduler

    @Inject lateinit var handler: PushHandler

    override fun onNewToken(token: String) = scheduler.registerToken(token)

    override fun onMessageReceived(message: RemoteMessage) = handler.handle(message.data)
}

/** Asks FCM for this device's token and registers it (a no-op when Firebase is not configured, as in tests). */
object PushTokens {
    fun refresh(scheduler: SyncScheduler) {
        runCatching {
            com.google.firebase.messaging.FirebaseMessaging.getInstance().token.addOnSuccessListener { scheduler.registerToken(it) }
        }
    }
}
