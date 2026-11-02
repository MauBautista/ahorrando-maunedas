package com.maubautista.maunedas.core.sync

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.workDataOf
import com.maubautista.maunedas.core.database.AppDatabase
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/** Sync scheduling of 04 §6.6. */
@Singleton
class SyncScheduler
    @Inject
    constructor(
        @ApplicationContext private val context: Context,
        private val db: AppDatabase,
    ) : SyncRequester,
        UploadRequester {
        private val work get() = WorkManager.getInstance(context)
        private val connected = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

        /** After every local write: one `sync-now`, 3 s later, once there is network. */
        override fun requestSoon() {
            work.enqueueUniqueWork(
                NOW,
                ExistingWorkPolicy.APPEND_OR_REPLACE,
                OneTimeWorkRequestBuilder<SyncWorker>()
                    .setInitialDelay(3, TimeUnit.SECONDS)
                    .setConstraints(connected)
                    .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                    .build(),
            )
        }

        /** "Sincronizar ahora": expedited when the quota allows. */
        fun syncNow() {
            work.enqueueUniqueWork(
                NOW,
                ExistingWorkPolicy.APPEND_OR_REPLACE,
                OneTimeWorkRequestBuilder<SyncWorker>()
                    .setConstraints(connected)
                    .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
                    .build(),
            )
        }

        /** Every 15 minutes while signed in; kept if already scheduled. */
        fun schedulePeriodic() {
            work.enqueueUniquePeriodicWork(
                PERIODIC,
                ExistingPeriodicWorkPolicy.KEEP,
                PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES).setConstraints(connected).build(),
            )
        }

        /** Binaries waiting (10 §4.2): one `upload` chain with network and exponential backoff. */
        override suspend fun enqueueIfPending() {
            if (db.pendingUploads().count() == 0) return
            work.enqueueUniqueWork(
                UPLOAD,
                ExistingWorkPolicy.KEEP,
                OneTimeWorkRequestBuilder<UploadWorker>()
                    .setConstraints(connected)
                    .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                    .build(),
            )
        }

        /** "Revisar ahora" of a listing (S-20): one request per listing, with network and backoff. */
        fun checkNow(listingId: String) {
            work.enqueueUniqueWork(
                CheckNowWorker.tagOf(listingId),
                ExistingWorkPolicy.KEEP,
                OneTimeWorkRequestBuilder<CheckNowWorker>()
                    .setInputData(workDataOf(CheckNowWorker.LISTING_ID to listingId))
                    .addTag(CheckNowWorker.TAG)
                    .addTag(CheckNowWorker.tagOf(listingId))
                    .setConstraints(connected)
                    .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                    .build(),
            )
        }

        /** A new FCM token (08 §6): sent by a worker, once, with network and backoff; the newest one wins. */
        fun registerToken(token: String) {
            work.enqueueUniqueWork(
                DEVICE_TOKEN,
                ExistingWorkPolicy.REPLACE,
                OneTimeWorkRequestBuilder<DeviceTokenWorker>()
                    .setInputData(workDataOf(DeviceTokenWorker.TOKEN to token))
                    .setConstraints(connected)
                    .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                    .build(),
            )
        }

        /** The listings whose "Revisar ahora" has not been sent yet. */
        fun pendingChecks(): Flow<Set<String>> =
            work.getWorkInfosByTagFlow(CheckNowWorker.TAG).map { infos ->
                infos.filter { !it.state.isFinished }
                    .flatMap { info -> info.tags.filter { it.startsWith("check-now:") }.map { it.removePrefix("check-now:") } }
                    .toSet()
            }

        /** Signing out (02 §6.4). */
        fun cancelAll() {
            work.cancelUniqueWork(NOW)
            work.cancelUniqueWork(PERIODIC)
            work.cancelUniqueWork(UPLOAD)
            work.cancelAllWorkByTag(CheckNowWorker.TAG)
            work.cancelUniqueWork(DEVICE_TOKEN)
        }

        companion object {
            const val NOW = "sync-now"
            const val PERIODIC = "sync-periodic"
            const val UPLOAD = "upload"
            const val DEVICE_TOKEN = "device-token"
        }
    }
