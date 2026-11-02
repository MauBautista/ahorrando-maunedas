package com.maubautista.maunedas.core.data

import com.maubautista.maunedas.core.database.AppDatabase
import com.maubautista.maunedas.core.database.dao.TrackedListingRow
import com.maubautista.maunedas.core.database.entity.ListingEntity
import com.maubautista.maunedas.core.model.Clock
import com.maubautista.maunedas.core.model.Uuids
import com.maubautista.maunedas.core.network.ApiException
import com.maubautista.maunedas.core.network.MaunedasApi
import com.maubautista.maunedas.core.network.dto.ResolveListingRequest
import com.maubautista.maunedas.core.sync.LocalWriter
import com.maubautista.maunedas.core.sync.SyncScheduler
import com.maubautista.maunedas.core.sync.SyncTables
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

/** Where a listing stands, from `active` and its last check (S-20, as the web's T-223). */
enum class ListingHealth { PAUSED, WAITING, OK, OUT_OF_STOCK, NOT_FOUND, BLOCKED, ERROR }

/** A followed link as S-20 shows it. */
data class TrackedListing(
    val id: String,
    val variantId: String,
    val productId: String,
    val productName: String,
    val variantLabel: String,
    val storeName: String,
    val url: String,
    val intervalMin: Long?,
    val active: Boolean,
    val health: ListingHealth,
    val lastCheckedAt: Long?,
    val priceCents: Long?,
    /** Only when higher than the price: a struck list price (08 §3 `promo`). */
    val listPriceCents: Long?,
    val promoText: String?,
    /** "Revisar ahora" asked and its check not here yet (still queued, or sent and not checked). */
    val checkRequested: Boolean,
)

/** A link the Worker can follow (`POST /v1/listings/resolve`). */
data class ResolvedLink(
    val adapter: String,
    val storeId: String,
    /** Null until the store comes down by sync. */
    val storeName: String?,
    val url: String,
    val canonicalUrl: String,
    val externalId: String?,
    /** "Producto · Variante" of the live listing that already follows it: S-21 does not follow it twice. */
    val followedBy: String?,
)

sealed interface ResolveOutcome {
    data class Resolved(val link: ResolvedLink) : ResolveOutcome

    /** `422 UNSUPPORTED_URL` with its `details.reason` (NO_URL, SHORT_LINK, NOT_TRACKED, NO_STORE; T-210). */
    data class Unsupported(val reason: String?) : ResolveOutcome

    data object NoNetwork : ResolveOutcome

    data class Failed(val message: String) : ResolveOutcome
}

/** A variant to follow a link for (S-21's picker). */
data class VariantOption(
    val id: String,
    val name: String,
    val brand: String?,
)

/**
 * Online price tracking on the phone (S-20, S-21): listings read from Room, written by [LocalWriter]. Resolving a
 * shared link is one of the direct network calls (05 §3); "Revisar ahora" goes through a worker.
 */
@Singleton
class TrackingRepository
    @Inject
    constructor(
        private val db: AppDatabase,
        private val api: MaunedasApi,
        private val writer: LocalWriter,
        private val clock: Clock,
        private val scheduler: SyncScheduler,
        private val editor: PurchaseEditor,
    ) {
        private val listingsTable = SyncTables.of<ListingEntity>("listings")

        fun listings(variantId: String?): Flow<List<TrackedListing>> =
            combine(db.tracking().listings(variantId), scheduler.pendingChecks()) { rows, pending ->
                rows.map { it.toListing(it.id in pending) }
            }

        /** "Leche Lala Entera · 1 L" of a variant opened by id (the product page's "Precios en línea"). */
        fun variantName(variantId: String): Flow<String?> =
            db.tracking().variantName(variantId).map { it?.let { n -> "${n.productName} · ${n.variantLabel}" } }

        suspend fun resolve(text: String): ResolveOutcome =
            try {
                val r = api.resolveListing(ResolveListingRequest(text.trim()))
                val twin = db.tracking().followed(r.canonicalUrl)
                ResolveOutcome.Resolved(
                    ResolvedLink(
                        adapter = r.adapter,
                        storeId = r.storeId,
                        storeName = db.tracking().storeName(r.storeId),
                        url = r.url,
                        canonicalUrl = r.canonicalUrl,
                        externalId = r.externalId,
                        followedBy = twin?.let { "${it.productName} · ${it.variantLabel}" },
                    ),
                )
            } catch (e: IOException) {
                ResolveOutcome.NoNetwork
            } catch (e: ApiException) {
                if (e.code == "UNSUPPORTED_URL") {
                    ResolveOutcome.Unsupported(e.details?.get("reason")?.jsonPrimitive?.contentOrNull)
                } else {
                    ResolveOutcome.Failed(e.message ?: "")
                }
            }

        /** Creates the listing (sync); the agent checks a new one within its next minute or so. Returns its id. */
        suspend fun follow(
            link: ResolvedLink,
            variantId: String,
        ): String {
            val now = clock.nowMillis()
            val row =
                ListingEntity(
                    id = Uuids.v7(now),
                    variantId = variantId,
                    storeId = link.storeId,
                    adapter = link.adapter,
                    url = link.url,
                    canonicalUrl = link.canonicalUrl,
                    externalId = link.externalId,
                    checkIntervalMin = null,
                    active = 1,
                    createdAt = now,
                    updatedAt = now,
                )
            writer.write(listingsTable, listOf(row))
            return row.id
        }

        suspend fun setActive(
            listingId: String,
            active: Boolean,
        ) {
            val row = db.listings().byId(listingId) ?: return
            writer.write(listingsTable, listOf(row.copy(active = if (active) 1 else 0)))
        }

        /** A tombstone: the prices already kept stay (history). */
        suspend fun stopFollowing(listingId: String) {
            val row = db.listings().byId(listingId) ?: return
            writer.delete(listingsTable, listOf(row))
        }

        fun checkNow(listingId: String) = scheduler.checkNow(listingId)

        suspend fun searchVariants(query: String): List<VariantOption> =
            editor.searchVariants(query, storeId = null).map { c ->
                VariantOption(c.variant.id, "${c.variant.productName} · ${c.variant.label}", c.variant.brand)
            }

        companion object {
            /** S-20's state of a listing. */
            fun health(
                active: Boolean,
                lastStatus: String?,
                lastInStock: Int?,
            ): ListingHealth =
                when {
                    !active -> ListingHealth.PAUSED
                    lastStatus == null || lastStatus == "pending" -> ListingHealth.WAITING
                    lastStatus == "ok" -> if (lastInStock == 0) ListingHealth.OUT_OF_STOCK else ListingHealth.OK
                    lastStatus == "not_found" -> ListingHealth.NOT_FOUND
                    lastStatus == "blocked" -> ListingHealth.BLOCKED
                    else -> ListingHealth.ERROR
                }
        }
    }

private fun TrackedListingRow.toListing(pendingCheck: Boolean): TrackedListing {
    val asked = checkRequestedAt
    val price = lastPriceCents
    val requested = asked != null && asked > (lastCheckedAt ?: 0)
    return TrackedListing(
        id = id,
        variantId = variantId,
        productId = productId,
        productName = productName,
        variantLabel = variantLabel,
        storeName = storeName,
        url = url,
        intervalMin = checkIntervalMin,
        active = active == 1,
        health = TrackingRepository.health(active == 1, lastStatus, lastInStock),
        lastCheckedAt = lastCheckedAt,
        priceCents = lastPriceCents,
        listPriceCents = lastListPriceCents?.takeIf { list -> price != null && list > price },
        promoText = lastPromoText,
        checkRequested = requested || pendingCheck,
    )
}
