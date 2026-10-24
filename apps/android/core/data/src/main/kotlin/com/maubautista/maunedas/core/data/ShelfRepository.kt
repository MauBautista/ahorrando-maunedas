package com.maubautista.maunedas.core.data

import androidx.room.withTransaction
import com.maubautista.maunedas.core.database.AppDatabase
import com.maubautista.maunedas.core.database.entity.ImageEntity
import com.maubautista.maunedas.core.database.entity.PriceObservationEntity
import com.maubautista.maunedas.core.database.entity.PromotionEntity
import com.maubautista.maunedas.core.model.Clock
import com.maubautista.maunedas.core.model.CurrentUser
import com.maubautista.maunedas.core.model.Uuids
import com.maubautista.maunedas.core.pricing.PromoParams
import com.maubautista.maunedas.core.pricing.PromoType
import com.maubautista.maunedas.core.pricing.Promotions
import com.maubautista.maunedas.core.pricing.ShelfPrices
import com.maubautista.maunedas.core.sync.LocalWriter
import com.maubautista.maunedas.core.sync.SyncTables
import com.maubautista.maunedas.core.sync.UploadQueue
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton

/** A shelf price as typed in S-13; [promoText] is how the promotion reads ("2x1", "15 % de descuento"…). */
data class ShelfDraft(
    val variantId: String,
    val storeId: String,
    val branchId: String?,
    val priceCents: Long,
    val promoType: PromoType? = null,
    val promoParams: PromoParams = PromoParams(),
    val promoText: String? = null,
    /** A photo of the shelf already reduced by [LocalPhotos.reduce]. */
    val photoPath: String? = null,
)

data class ShelfPlace(
    val storeId: String,
    val branchId: String?,
)

/**
 * S-13 (RF-PRE-01): a `shelf` observation at the current time with its promotion and optional photo, written in one
 * transaction through [LocalWriter]; it feeds prices at once (`v_price_points`).
 */
@Singleton
class ShelfRepository
    @Inject
    constructor(
        private val db: AppDatabase,
        private val writer: LocalWriter,
        private val clock: Clock,
        private val user: CurrentUser,
        private val photos: LocalPhotos,
        private val uploads: UploadQueue,
    ) {
        private val observations = SyncTables.of<PriceObservationEntity>("price_observations")
        private val promotions = SyncTables.of<PromotionEntity>("promotions")
        private val images = SyncTables.of<ImageEntity>("images")

        /** The store and branch of my latest shelf price ("recuerda la última"). */
        suspend fun lastPlace(): ShelfPlace? = user.id()?.let { db.shelf().lastPlace(it) }?.let { ShelfPlace(it.storeId, it.branchId) }

        /** The variant a scanned code belongs to, if any. */
        suspend fun variantOfCode(code: String): String? = db.purchaseEdits().variantOfBarcode(code)

        /**
         * Writes the observation (`effective_price_cents` from [ShelfPrices.effective]), its `promotions` row
         * (`observation_id`) when there is one and its `shelf_photo` image, whose original then waits in the upload
         * queue; returns the observation id. The photo is moved into place first, so no row points to a missing file.
         */
        suspend fun save(draft: ShelfDraft): String {
            val now = clock.nowMillis()
            val photo = draft.photoPath?.let { path -> Uuids.v7(now).let { id -> id to photos.keep(id, File(path)) } }
            val id =
                db.withTransaction {
                    val type = draft.promoType
                    val effective = type?.let { ShelfPrices.effective(it, draft.promoParams, draft.priceCents) }
                    val text = draft.promoText?.trim()?.take(300)?.ifEmpty { null }
                    val observation =
                        PriceObservationEntity(
                            id = Uuids.v7(now),
                            variantId = draft.variantId,
                            storeId = draft.storeId,
                            branchId = draft.branchId,
                            source = "shelf",
                            priceCents = draft.priceCents,
                            effectivePriceCents = effective,
                            promoText = if (type != null) text else null,
                            observedAt = now,
                            photoImageId = photo?.first,
                            createdAt = now,
                            updatedAt = now,
                        )
                    writer.write(observations, listOf(observation))
                    photo?.let { (imageId, _) ->
                        val image =
                            ImageEntity(
                                id = imageId,
                                ownerType = "observation",
                                ownerId = observation.id,
                                role = "shelf_photo",
                                source = "user",
                                originalKey = "images/$imageId/${LocalPhotos.ORIGINAL}",
                                createdAt = now,
                                updatedAt = now,
                            )
                        writer.write(images, listOf(image))
                    }
                    if (type != null) {
                        val params = if (type == PromoType.PRICE_CUT) draft.promoParams.copy(fromCents = draft.priceCents.toDouble()) else draft.promoParams
                        writer.write(
                            promotions,
                            listOf(
                                PromotionEntity(
                                    id = Uuids.v7(now),
                                    observationId = observation.id,
                                    type = type.wire,
                                    params = PromoParamsJson.encode(params),
                                    description = text,
                                    // Per unit, as the observation's prices.
                                    discountCents = effective?.let { draft.priceCents - it } ?: 0,
                                    affectsPrice = if (Promotions.affectsPrice(type)) 1 else 0,
                                    createdAt = now,
                                    updatedAt = now,
                                ),
                            ),
                        )
                    }
                    observation.id
                }
            photo?.let { (imageId, file) -> uploads.enqueueBlob(imageId, LocalPhotos.ORIGINAL, file.path) }
            return id
        }
    }
