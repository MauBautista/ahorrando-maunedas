package com.maubautista.maunedas

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.work.Configuration
import androidx.work.WorkManager
import androidx.work.testing.SynchronousExecutor
import androidx.work.testing.WorkManagerTestInitHelper
import com.maubautista.maunedas.core.database.AppDatabase
import com.maubautista.maunedas.core.sync.SyncScheduler
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf

/** FCM data messages to notifications (08 §7) and the link a price alert opens. */
@RunWith(RobolectricTestRunner::class)
class NotificationsTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val db = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java).allowMainThreadQueries().build()
    private val notifier = AlertNotifier(context)
    private val manager = context.getSystemService(NotificationManager::class.java)
    private lateinit var handler: PushHandler

    @Before
    fun start() {
        WorkManagerTestInitHelper.initializeTestWorkManager(context, Configuration.Builder().setExecutor(SynchronousExecutor()).build())
        notifier.createChannels()
        handler = PushHandler(notifier, SyncScheduler(context, db))
    }

    @After
    fun close() = db.close()

    @Test
    fun channelsAreTheTwoOf08() {
        assertEquals(NotificationManager.IMPORTANCE_HIGH, manager.getNotificationChannel("price_alerts").importance)
        assertEquals("Alertas de precio", manager.getNotificationChannel("price_alerts").name)
        assertEquals("Avisos del sistema", manager.getNotificationChannel("system").name)
    }

    @Test
    fun aPriceAlertOpensItsVariantAndReplacesTheLastOneOfIt() {
        val data = mapOf("type" to "price_alert", "title" to "Leche bajó a $24.90", "body" to "En Costco.", "variant_id" to "v1", "event_id" to "e1")
        handler.handle(data)
        handler.handle(data + ("title" to "Leche bajó a $23.90"))
        val shown = shadowOf(manager).allNotifications
        assertEquals(1, shown.size)
        val n = shown.single()
        assertEquals("price_alerts", n.channelId)
        assertEquals("Leche bajó a $23.90", shadowOf(n).contentTitle)
        assertEquals("En Costco.", shadowOf(n).contentText)
        val opens = shadowOf(n.contentIntent).savedIntent
        assertEquals(Uri.parse("maunedas://variant/v1"), opens.data)
        assertEquals(MainActivity::class.java.name, opens.component?.className)
        // The alert comes down with a sync right away (one per message, chained).
        assertEquals(2, WorkManager.getInstance(context).getWorkInfosForUniqueWork(SyncScheduler.NOW).get().size)
    }

    @Test
    fun aSystemNoticeGoesToItsChannelAndUnknownTypesAreIgnored() {
        handler.handle(mapOf("type" to "system", "title" to "Servidor casero sin conexión", "body" to "Desde las 10:05.", "channel" to "system"))
        handler.handle(mapOf("type" to "something_new", "title" to "x", "body" to "y"))
        val shown = shadowOf(manager).allNotifications
        assertEquals(listOf("system"), shown.map { it.channelId })
        // An unknown type asks for nothing.
        assertEquals(1, WorkManager.getInstance(context).getWorkInfosForUniqueWork(SyncScheduler.NOW).get().size)
        assertNull(shadowOf(shown.single().contentIntent).savedIntent.data)
    }

    @Test
    fun onlyAVariantLinkIsReadFromAnIntent() {
        assertEquals("v1", linkedVariantOf(Intent(Intent.ACTION_VIEW, Uri.parse("maunedas://variant/v1"))))
        assertNull(linkedVariantOf(Intent(Intent.ACTION_VIEW, Uri.parse("maunedas://purchase/p1"))))
        assertNull(linkedVariantOf(Intent(Intent.ACTION_VIEW, Uri.parse("https://variant/v1"))))
        assertNull(linkedVariantOf(Intent(Intent.ACTION_MAIN)))
        assertNull(linkedVariantOf(null))
    }
}
