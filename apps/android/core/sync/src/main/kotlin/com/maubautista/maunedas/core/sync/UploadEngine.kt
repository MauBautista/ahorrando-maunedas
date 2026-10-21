package com.maubautista.maunedas.core.sync

import com.maubautista.maunedas.core.database.AppDatabase
import com.maubautista.maunedas.core.database.entity.PendingUploadEntity
import com.maubautista.maunedas.core.database.entity.SyncIssueEntity
import com.maubautista.maunedas.core.model.Clock
import com.maubautista.maunedas.core.network.ApiException
import com.maubautista.maunedas.core.network.MaunedasApi
import com.maubautista.maunedas.core.network.dto.ImportImageRequest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.asRequestBody
import java.io.File
import javax.inject.Inject

/**
 * Uploads pending binaries and open catalog imports (10 §4.2), oldest first. A blob waits until its
 * `images` or `image_renditions` row left the outbox: the Worker only accepts a key whose row it knows.
 */
class UploadEngine
    @Inject
    constructor(
        private val db: AppDatabase,
        private val api: MaunedasApi,
        private val json: Json,
        private val clock: Clock,
    ) {
        /** What is left after a run. */
        data class Outcome(val uploaded: Int, val waitingForSync: Int, val toRetry: Int)

        /** Stops at the first network failure (IOException propagates); server answers are handled per upload. */
        suspend fun uploadAll(): Outcome {
            var uploaded = 0
            var waiting = 0
            var retry = 0
            for (upload in db.pendingUploads().next(limit = 500)) {
                if (rowStillPending(upload)) {
                    waiting++
                    continue
                }
                when (send(upload)) {
                    Result.DONE -> uploaded++
                    Result.RETRY -> retry++
                    Result.DROPPED -> Unit
                }
            }
            return Outcome(uploaded, waiting, retry)
        }

        private enum class Result { DONE, RETRY, DROPPED }

        private suspend fun rowStillPending(upload: PendingUploadEntity): Boolean {
            val rendition = upload.name.substringBefore('.').takeIf { it != "original" }
            return db.outbox().contains("images", upload.imageId) ||
                (rendition != null && db.outbox().contains("image_renditions", rendition))
        }

        private suspend fun send(upload: PendingUploadEntity): Result {
            try {
                when (upload.kind) {
                    KIND_IMPORT -> api.importImage(upload.imageId, ImportImageRequest(upload.sourceUrl ?: return drop(upload, "MISSING_SOURCE_URL")))
                    else -> {
                        val file = upload.localPath?.let(::File)?.takeIf { it.isFile } ?: return drop(upload, "LOCAL_FILE_MISSING")
                        val type = upload.contentType ?: contentTypeOf(upload.name)
                        api.uploadBlob(upload.imageId, upload.name, file.asRequestBody(type.toMediaType()))
                    }
                }
            } catch (e: ApiException) {
                return when {
                    // The row has not reached the server yet (10 §4.2), the server is down or the session is being
                    // renewed: next run. Signing out clears the queue anyway (02 §6.4).
                    e.code == "IMAGE_NOT_FOUND" || e.status >= 500 || e.status in RETRYABLE_STATUS -> {
                        db.pendingUploads().markFailed(upload.id, e.code)
                        Result.RETRY
                    }
                    // Too large, wrong type, a host not allowed…: retrying cannot help.
                    else -> drop(upload, e.code, e.details)
                }
            }
            // The local file stays as a cache (10 §4.2).
            db.pendingUploads().remove(upload.id)
            return Result.DONE
        }

        private suspend fun drop(
            upload: PendingUploadEntity,
            reason: String,
            details: JsonObject? = null,
        ): Result {
            db.syncIssues().add(
                SyncIssueEntity(
                    tableName = "pending_uploads",
                    rowId = "${upload.imageId}/${upload.name}",
                    reason = reason,
                    detailsJson = details?.let { json.encodeToString(JsonObject.serializer(), it) },
                    createdAt = clock.nowMillis(),
                ),
            )
            db.pendingUploads().remove(upload.id)
            return Result.DROPPED
        }

        companion object {
            const val KIND_BLOB = "blob"
            const val KIND_IMPORT = "import"

            private val RETRYABLE_STATUS = setOf(401, 403, 429)

            /** The Content-Type the Worker expects for each extension (10 §4.1). */
            fun contentTypeOf(name: String): String =
                when (name.substringAfterLast('.').lowercase()) {
                    "jpg" -> "image/jpeg"
                    "png" -> "image/png"
                    "webp" -> "image/webp"
                    else -> "application/octet-stream"
                }
        }
    }
