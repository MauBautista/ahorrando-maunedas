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
 * "Mejorar en casa" (10 §6.1, T-300): only workers touch the network (CLAUDE.md rule 12). The image row goes up
 * first; while its original is still uploading the Worker says `409 IMAGE_NOT_UPLOADED` and this tries again later.
 */
@HiltWorker
class EnhanceWorker
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
            val imageId = inputData.getString(IMAGE_ID) ?: return Result.failure()
            if (db.outbox().pendingFor("images", imageId) > 0) {
                scheduler.syncNow()
                return Result.retry()
            }
            return try {
                api.enhance(imageId)
                Result.success()
            } catch (e: IOException) {
                Result.retry()
            } catch (e: ApiException) {
                // Not uploaded yet, or the server's own errors: later. 404 (deleted or not a product photo): done.
                if (e.code == "IMAGE_NOT_UPLOADED" || e.status >= 500) Result.retry() else Result.success()
            }
        }

        companion object {
            const val IMAGE_ID = "image_id"
            const val TAG = "enhance"

            fun tagOf(imageId: String) = "enhance:$imageId"
        }
    }
