package com.maubautista.maunedas.core.data

import com.maubautista.maunedas.core.database.AppDatabase
import com.maubautista.maunedas.core.database.entity.ImageEntity
import com.maubautista.maunedas.core.model.Clock
import com.maubautista.maunedas.core.sync.LocalWriter
import com.maubautista.maunedas.core.sync.SyncScheduler
import com.maubautista.maunedas.core.sync.SyncTables
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flowOf
import javax.inject.Inject
import javax.inject.Singleton

/** What "Mejorar en casa" can do for a photo (10 §6.1). */
enum class EnhanceState {
    /** No product photo with an original to send. */
    NONE,
    AVAILABLE,

    /** Asked, and no home-server result since. */
    PENDING,
}

/**
 * "Mejorar en casa" from the phone (10 §6.1, T-300): the request is `enhance_requested_at` by sync plus an
 * `EnhanceWorker` that asks the Worker once the original is up; the result comes back by pull and is adopted there.
 */
@Singleton
class PhotoEnhancer
    @Inject
    constructor(
        private val db: AppDatabase,
        private val writer: LocalWriter,
        private val scheduler: SyncScheduler,
        private val clock: Clock,
    ) {
        fun state(imageId: String?): Flow<EnhanceState> {
            if (imageId == null) return flowOf(EnhanceState.NONE)
            return combine(db.images().observe(imageId), db.imageRenditions().latestHomeAt(imageId)) { image, homeAt ->
                val asked = image?.enhanceRequestedAt
                when {
                    image == null || !image.enhanceable() -> EnhanceState.NONE
                    asked != null && (homeAt ?: 0) < asked -> EnhanceState.PENDING
                    else -> EnhanceState.AVAILABLE
                }
            }
        }

        suspend fun request(imageId: String) {
            val image = db.images().byId(imageId)?.takeIf { it.enhanceable() } ?: return
            writer.write(images, listOf(image.copy(enhanceRequestedAt = clock.nowMillis())))
            scheduler.enhance(imageId)
        }

        /** The Worker takes a live product photo whose original exists (10 §6.1). */
        private fun ImageEntity.enhanceable() = deletedAt == null && role == "catalog" && originalKey != null

        private companion object {
            val images = SyncTables.of<ImageEntity>("images")
        }
    }
