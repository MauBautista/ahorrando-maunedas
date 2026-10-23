package com.maubautista.maunedas.core.auth

import android.content.Context
import com.maubautista.maunedas.core.database.AppDatabase
import com.maubautista.maunedas.core.network.MaunedasApi
import com.maubautista.maunedas.core.sync.DeviceIdStore
import com.maubautista.maunedas.core.sync.SyncScheduler
import com.maubautista.maunedas.core.sync.SyncStatusStore
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import javax.inject.Inject

/**
 * Signing out (02 §6.4): unregisters the device if there is network, signs Firebase out and wipes Room, the
 * local images, the session and the device id, and cancels sync. The screen warns first when [pendingChanges]
 * is not zero: those changes are lost.
 */
class SignOutCleaner
    @Inject
    constructor(
        @ApplicationContext private val context: Context,
        private val db: AppDatabase,
        private val api: MaunedasApi,
        private val session: SessionStore,
        private val deviceId: DeviceIdStore,
        private val scheduler: SyncScheduler,
        private val status: SyncStatusStore,
    ) {
        suspend fun pendingChanges(): Int = db.outbox().count() + db.pendingUploads().count()

        suspend fun signOut(signOutOfFirebase: suspend () -> Unit) {
            runCatching { api.unregisterDevice(deviceId.get()) }
            signOutOfFirebase()
            scheduler.cancelAll()
            withContext(Dispatchers.IO) {
                db.clearAllTables()
                File(context.filesDir, "images").deleteRecursively()
            }
            session.clear()
            deviceId.clear()
            status.clear()
        }
    }
