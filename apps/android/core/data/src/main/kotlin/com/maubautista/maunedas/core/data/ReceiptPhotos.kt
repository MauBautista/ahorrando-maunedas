package com.maubautista.maunedas.core.data

import androidx.room.withTransaction
import com.maubautista.maunedas.core.database.AppDatabase
import com.maubautista.maunedas.core.database.entity.ImageEntity
import com.maubautista.maunedas.core.model.Clock
import com.maubautista.maunedas.core.model.Uuids
import com.maubautista.maunedas.core.sync.LocalWriter
import com.maubautista.maunedas.core.sync.SyncTables
import com.maubautista.maunedas.core.sync.UploadQueue
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

/** A receipt page: its image and what Coil shows of it (the original, 10 §1). */
data class ReceiptPage(
    val imageId: String,
    val photo: Any?,
)

/**
 * RF-TIC-01: the pages of a purchase's receipt (1 to 4), written as soon as they are taken so they survive without
 * network or a closed app: an `images` row each (`owner_type='purchase'`, `role='receipt'`, in page order by
 * `created_at`) and its original in the upload queue (09 §3).
 */
@Singleton
class ReceiptPhotos
    @Inject
    constructor(
        private val db: AppDatabase,
        private val writer: LocalWriter,
        private val clock: Clock,
        private val photos: LocalPhotos,
        private val images: ProductPhotos,
        private val uploads: UploadQueue,
    ) {
        private val table = SyncTables.of<ImageEntity>("images")

        fun pages(purchaseId: String): Flow<List<ReceiptPage>> =
            db.images().receiptPages(purchaseId).map { rows -> rows.map { ReceiptPage(it.id, images.large(it.id)) } }

        /**
         * Adds [reduced] pages (by [LocalPhotos.reduce] as receipts) after the ones the purchase has, up to [MAX_PAGES];
         * returns how many were added. Each page is moved into place before its row is written.
         */
        suspend fun attach(
            purchaseId: String,
            reduced: List<File>,
        ): Int {
            val now = clock.nowMillis()
            val existing = db.images().liveOf("purchase", purchaseId, "receipt")
            val room = (MAX_PAGES - existing.size).coerceAtLeast(0)
            reduced.drop(room).forEach { it.delete() }
            // Later pages sort after the ones there are: created_at follows the order they were taken.
            val start = maxOf(now, (existing.maxOfOrNull { it.createdAt } ?: Long.MIN_VALUE) + 1)
            val kept = reduced.take(room).mapIndexed { i, file -> Uuids.v7(now).let { id -> Triple(id, photos.keep(id, file), start + i) } }
            if (kept.isEmpty()) return 0
            db.withTransaction {
                writer.write(
                    table,
                    kept.map { (id, _, at) ->
                        ImageEntity(
                            id = id,
                            ownerType = "purchase",
                            ownerId = purchaseId,
                            role = "receipt",
                            source = "user",
                            originalKey = "images/$id/${LocalPhotos.ORIGINAL}",
                            createdAt = at,
                            updatedAt = at,
                        )
                    },
                )
            }
            kept.forEach { (id, file, _) -> uploads.enqueueBlob(id, LocalPhotos.ORIGINAL, file.path) }
            return kept.size
        }

        /** Takes a page away (a tombstone; its blob stays in R2). */
        suspend fun remove(imageId: String) {
            db.images().byId(imageId)?.takeIf { it.deletedAt == null }?.let { writer.delete(table, listOf(it)) }
        }

        companion object {
            /** 09 §4.1: `image_ids` 1..4. */
            const val MAX_PAGES = 4
        }
    }
