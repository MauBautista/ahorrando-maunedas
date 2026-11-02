package com.maubautista.maunedas

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.maubautista.maunedas.core.sync.SyncScheduler
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton
import com.maubautista.maunedas.core.designsystem.R as DesignR

/** The two channels of 08 §7 and the notifications the app builds from FCM data messages. */
@Singleton
class AlertNotifier
    @Inject
    constructor(
        @ApplicationContext private val context: Context,
    ) {
        fun createChannels() {
            val manager = context.getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(NotificationChannel(PRICE_ALERTS, context.getString(R.string.channel_price_alerts), NotificationManager.IMPORTANCE_HIGH))
            manager.createNotificationChannel(NotificationChannel(SYSTEM, context.getString(R.string.channel_system), NotificationManager.IMPORTANCE_DEFAULT))
        }

        /** Opens the variant's product page (`maunedas://variant/{id}`); a newer alert of the same variant replaces it. */
        fun showPriceAlert(
            title: String,
            body: String,
            variantId: String,
        ) = show(PRICE_ALERTS, variantId, title, body, Uri.parse("$VARIANT_LINK$variantId"))

        fun showSystem(
            title: String,
            body: String,
        ) = show(SYSTEM, SYSTEM, title, body, null)

        private fun show(
            channel: String,
            tag: String,
            title: String,
            body: String,
            link: Uri?,
        ) {
            val open =
                Intent(context, MainActivity::class.java).apply {
                    action = Intent.ACTION_VIEW
                    data = link
                    flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
                }
            val pending = PendingIntent.getActivity(context, tag.hashCode(), open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
            val notification =
                NotificationCompat.Builder(context, channel)
                    .setSmallIcon(DesignR.drawable.ic_sell)
                    .setContentTitle(title)
                    .setContentText(body)
                    .setStyle(NotificationCompat.BigTextStyle().bigText(body))
                    .setAutoCancel(true)
                    .setContentIntent(pending)
                    .build()
            // Without POST_NOTIFICATIONS (API 33+) nothing shows; the alert stays in S-23.
            if (NotificationManagerCompat.from(context).areNotificationsEnabled()) {
                @Suppress("MissingPermission")
                NotificationManagerCompat.from(context).notify(tag, NOTIFICATION_ID, notification)
            }
        }

        companion object {
            const val PRICE_ALERTS = "price_alerts"
            const val SYSTEM = "system"
            const val VARIANT_LINK = "maunedas://variant/"
            private const val NOTIFICATION_ID = 1
        }
    }

/** What an FCM data message does (08 §6, §7); the service only hands it over, so this is what tests drive. */
class PushHandler
    @Inject
    constructor(
        private val notifier: AlertNotifier,
        private val scheduler: SyncScheduler,
    ) {
        fun handle(data: Map<String, String>) {
            val title = data["title"].orEmpty()
            val body = data["body"].orEmpty()
            when (data["type"]) {
                "price_alert" -> data["variant_id"]?.let { notifier.showPriceAlert(title, body, it) } ?: notifier.showSystem(title, body)
                "system" -> notifier.showSystem(title, body)
                else -> return
            }
            // The alert and the listing state come down with the next pull.
            scheduler.syncNow()
        }
    }
