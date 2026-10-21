package com.maubautista.maunedas.core.sync

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.maubautista.maunedas.core.model.Clock
import com.maubautista.maunedas.core.model.CurrentUser
import com.maubautista.maunedas.core.network.ApiException
import com.maubautista.maunedas.core.network.UpgradeRequiredException
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import java.io.IOException

/**
 * The only place, with UploadWorker, that touches the network (CLAUDE.md rule 12). Without a session it does
 * nothing; network failures and server errors retry with backoff; an old app waits for an update (04 §5).
 */
@HiltWorker
class SyncWorker
    @AssistedInject
    constructor(
        @Assisted context: Context,
        @Assisted params: WorkerParameters,
        private val user: CurrentUser,
        private val engine: SyncEngine,
        private val status: SyncStatusStore,
        private val clock: Clock,
    ) : CoroutineWorker(context, params) {
        override suspend fun doWork(): Result {
            if (user.id() == null) return Result.success()
            return try {
                engine.sync()
                status.set(SyncStatus.Synced(clock.nowMillis()))
                Result.success()
            } catch (e: UpgradeRequiredException) {
                status.set(SyncStatus.UpgradeRequired)
                Result.success()
            } catch (e: IOException) {
                status.set(SyncStatus.Failed(clock.nowMillis(), "NETWORK"))
                Result.retry()
            } catch (e: ApiException) {
                status.set(SyncStatus.Failed(clock.nowMillis(), e.code))
                if (e.status >= 500 || e.status == 429) Result.retry() else Result.failure()
            }
        }
    }
