package com.maubautista.maunedas.core.database.dao

import androidx.room.ColumnInfo
import androidx.room.Dao
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

/** A live listing with what S-20 shows: its variant, store and last check (`listing_state`, null before one). */
data class TrackedListingRow(
    val id: String,
    @ColumnInfo(name = "variant_id") val variantId: String,
    @ColumnInfo(name = "product_id") val productId: String,
    @ColumnInfo(name = "product_name") val productName: String,
    @ColumnInfo(name = "variant_label") val variantLabel: String,
    @ColumnInfo(name = "store_name") val storeName: String,
    val url: String,
    @ColumnInfo(name = "canonical_url") val canonicalUrl: String?,
    @ColumnInfo(name = "check_interval_min") val checkIntervalMin: Long?,
    val active: Int,
    @ColumnInfo(name = "last_checked_at") val lastCheckedAt: Long?,
    @ColumnInfo(name = "last_status") val lastStatus: String?,
    @ColumnInfo(name = "last_price_cents") val lastPriceCents: Long?,
    @ColumnInfo(name = "last_list_price_cents") val lastListPriceCents: Long?,
    @ColumnInfo(name = "last_in_stock") val lastInStock: Int?,
    @ColumnInfo(name = "last_promo_text") val lastPromoText: String?,
    @ColumnInfo(name = "check_requested_at") val checkRequestedAt: Long?,
)

/** A variant's names, for a screen opened with its id. */
data class VariantNameRow(
    @ColumnInfo(name = "product_name") val productName: String,
    @ColumnInfo(name = "variant_label") val variantLabel: String,
)

@Dao
interface TrackingDao {
    /** S-20: every live listing, or those of [variantId], by product, variant and store, as the web (T-223). */
    @Query(
        """
        SELECT l.id, l.variant_id, v.product_id, p.name AS product_name, v.label AS variant_label,
               s.name AS store_name, l.url, l.canonical_url, l.check_interval_min, l.active,
               st.last_checked_at, st.last_status, st.last_price_cents, st.last_list_price_cents, st.last_in_stock,
               st.last_promo_text, st.check_requested_at
        FROM listings l
        JOIN variants v ON v.id = l.variant_id
        JOIN products p ON p.id = v.product_id
        JOIN stores s ON s.id = l.store_id
        LEFT JOIN listing_state st ON st.listing_id = l.id
        WHERE l.deleted_at IS NULL AND (:variantId IS NULL OR l.variant_id = :variantId)
        ORDER BY p.name COLLATE NOCASE, v.label COLLATE NOCASE, s.name COLLATE NOCASE, l.created_at, l.id
        """,
    )
    fun listings(variantId: String?): Flow<List<TrackedListingRow>>

    /** The live listing that already follows this page (S-21 refuses following it twice). */
    @Query(
        """
        SELECT p.name AS product_name, v.label AS variant_label
        FROM listings l JOIN variants v ON v.id = l.variant_id JOIN products p ON p.id = v.product_id
        WHERE l.deleted_at IS NULL AND COALESCE(l.canonical_url, l.url) = :canonicalUrl
        LIMIT 1
        """,
    )
    suspend fun followed(canonicalUrl: String): VariantNameRow?

    @Query(
        """
        SELECT p.name AS product_name, v.label AS variant_label
        FROM variants v JOIN products p ON p.id = v.product_id WHERE v.id = :variantId
        """,
    )
    fun variantName(variantId: String): Flow<VariantNameRow?>

    @Query("SELECT name FROM stores WHERE id = :storeId")
    suspend fun storeName(storeId: String): String?
}
