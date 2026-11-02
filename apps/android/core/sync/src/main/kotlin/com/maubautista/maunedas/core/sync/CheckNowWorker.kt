package com.maubautista.maunedas.core.sync

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.maubautista.maunedas.core.database.AppDatabase
import com.maubautista.maunedas.core.model.CurrentUser
import com.maubautista.maunedas.core.network.ApiException
import com.maubautista.maunedas.core.network.MaunedasApi
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import java.io.IOException

/**
 * "Revisar ahora" (S-20, 03 §11): only workers touch the network (CLAUDE.md rule 12). A listing still in the
 * outbox is pushed first; afterwards a sync brings down the `listing_state` with the request.
 */
@HiltWorker
class CheckNowWorker
    @AssistedInject
    constructor(
        @Assisted context: Context,
        @Assisted params: WorkerParameters,
        private val user: CurrentUser,
        private val db: AppDatabase,
        private val api: MaunedasApi,
        private val scheduler: SyncScheduler,
    ) : CoroutineWorker(context, params) {
        override suspend fun doWork(): Result {
            if (user.id() == null) return Result.success()
            val listingId = inputData.getString(LISTING_ID) ?: return Result.failure()
            if (db.outbox().pendingFor("listings", listingId) > 0) {
                scheduler.syncNow()
                return Result.retry()
            }
            return try {
                api.checkNow(listingId)
                scheduler.syncNow()
                Result.success()
            } catch (e: IOException) {
                Result.retry()
            } catch (e: ApiException) {
                // 404: removed meanwhile; 4xx will not change by retrying. The server's own errors may.
                if (e.status >= 500) Result.retry() else Result.success()
            }
        }

        companion object {
            const val LISTING_ID = "listing_id"
            const val TAG = "check-now"

            fun tagOf(listingId: String) = "check-now:$listingId"
        }
    }
