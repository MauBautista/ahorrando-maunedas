package com.maubautista.maunedas.core.sync

import com.maubautista.maunedas.core.database.AppDatabase
import com.maubautista.maunedas.core.database.entity.PendingUploadEntity
import com.maubautista.maunedas.core.model.Clock
import javax.inject.Inject

/**
 * Queues binaries for [UploadWorker]. Call it after writing the `images` / `image_renditions` rows with
 * [LocalWriter]: the blob waits for them to be pushed. A blob already queued is not queued twice.
 */
class UploadQueue
    @Inject
    constructor(
        private val db: AppDatabase,
        private val clock: Clock,
        private val uploads: UploadRequester,
    ) {
        suspend fun enqueueBlob(
            imageId: String,
            name: String,
            localPath: String,
        ) {
            db.pendingUploads().enqueue(
                PendingUploadEntity(
                    kind = UploadEngine.KIND_BLOB,
                    imageId = imageId,
                    name = name,
                    localPath = localPath,
                    contentType = UploadEngine.contentTypeOf(name),
                    createdAt = clock.nowMillis(),
                ),
            )
            uploads.enqueueIfPending()
        }

        /** An open catalog photo to import as the original (10 §2.3), when there was no network at the time. */
        suspend fun enqueueImport(
            imageId: String,
            originalName: String,
            sourceUrl: String,
        ) {
            db.pendingUploads().enqueue(
                PendingUploadEntity(
                    kind = UploadEngine.KIND_IMPORT,
                    imageId = imageId,
                    name = originalName,
                    sourceUrl = sourceUrl,
                    createdAt = clock.nowMillis(),
                ),
            )
            uploads.enqueueIfPending()
        }
    }

/** Starts the upload worker when something waits (04 §6.6: after a successful push and on enqueue). */
fun interface UploadRequester {
    suspend fun enqueueIfPending()
}
