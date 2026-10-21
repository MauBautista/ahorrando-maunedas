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
import dagger.hilt.android.qualifiers.ApplicationContext
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/** Sync scheduling of 04 §6.6. */
@Singleton
class SyncScheduler
    @Inject
    constructor(
        @ApplicationContext private val context: Context,
    ) : SyncRequester {
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

        /** Signing out (02 §6.4). */
        fun cancelAll() {
            work.cancelUniqueWork(NOW)
            work.cancelUniqueWork(PERIODIC)
        }

        companion object {
            const val NOW = "sync-now"
            const val PERIODIC = "sync-periodic"
        }
    }
