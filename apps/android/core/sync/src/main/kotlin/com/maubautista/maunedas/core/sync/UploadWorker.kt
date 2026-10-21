package com.maubautista.maunedas.core.sync

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.maubautista.maunedas.core.model.CurrentUser
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import java.io.IOException

/**
 * Uploads with network and exponential backoff (10 §4.2). Blobs still waiting for their row are not a
 * failure: SyncWorker starts this worker again after the next successful push.
 */
@HiltWorker
class UploadWorker
    @AssistedInject
    constructor(
        @Assisted context: Context,
        @Assisted params: WorkerParameters,
        private val user: CurrentUser,
        private val engine: UploadEngine,
    ) : CoroutineWorker(context, params) {
        override suspend fun doWork(): Result {
            if (user.id() == null) return Result.success()
            return try {
                val outcome = engine.uploadAll()
                if (outcome.toRetry > 0) Result.retry() else Result.success()
            } catch (e: IOException) {
                Result.retry()
            }
        }
    }
