package com.maubautista.maunedas.core.database.dao

import androidx.room.ColumnInfo
import androidx.room.Dao
import androidx.room.Query
import com.maubautista.maunedas.core.database.entity.StoreBranchEntity
import kotlinx.coroutines.flow.Flow

/** A variant with what a purchase line shows and computes from it. */
data class LineVariantRow(
    val id: String,
    val label: String,
    val measure: String,
    @ColumnInfo(name = "unit_amount") val unitAmount: Double,
    @ColumnInfo(name = "pack_count") val packCount: Long,
    @ColumnInfo(name = "sold_by_weight") val soldByWeight: Int,
    @ColumnInfo(name = "product_id") val productId: String,
    @ColumnInfo(name = "product_name") val productName: String,
    val brand: String?,
    @ColumnInfo(name = "display_unit") val displayUnit: String,
    @ColumnInfo(name = "search_key") val searchKey: String,
)

/** A store with the time of its latest live purchase (S-14 sorts by recent use). */
data class StoreUseRow(
    val id: String,
    val name: String,
    @ColumnInfo(name = "last_used") val lastUsed: Long?,
)

/** Reads of the purchase editor (S-04, S-05, S-14); writes go through LocalWriter. */
@Dao
interface PurchaseEditDao {
    @Query(
        """
        SELECT v.id, v.label, v.measure, v.unit_amount, v.pack_count, v.sold_by_weight, p.id AS product_id,
               p.name AS product_name, p.brand, p.display_unit, p.search_key
        FROM variants v JOIN products p ON p.id = v.product_id
        WHERE v.id IN (:ids)
        """,
    )
    suspend fun variants(ids: List<String>): List<LineVariantRow>

    /** Every live variant of a live product, to search by words in memory (a household catalog is small). */
    @Query(
        """
        SELECT v.id, v.label, v.measure, v.unit_amount, v.pack_count, v.sold_by_weight, p.id AS product_id,
               p.name AS product_name, p.brand, p.display_unit, p.search_key
        FROM variants v JOIN products p ON p.id = v.product_id
        WHERE v.deleted_at IS NULL AND p.deleted_at IS NULL
        ORDER BY p.search_key, v.label, v.id
        """,
    )
    suspend fun liveVariants(): List<LineVariantRow>

    @Query(
        """
        SELECT b.variant_id FROM barcodes b JOIN variants v ON v.id = b.variant_id
        WHERE b.code = :code AND b.deleted_at IS NULL AND v.deleted_at IS NULL LIMIT 1
        """,
    )
    suspend fun variantOfBarcode(code: String): String?

    /** The list price of the newest point of that variant at that store (S-05 fills the price with it). */
    @Query(
        """
        SELECT list_unit_cents FROM v_price_points WHERE variant_id = :variantId AND store_id = :storeId
        ORDER BY observed_at DESC, point_id DESC LIMIT 1
        """,
    )
    suspend fun lastListPrice(
        variantId: String,
        storeId: String,
    ): Long?

    @Query(
        """
        SELECT s.id, s.name, MAX(p.purchased_at) AS last_used
        FROM stores s LEFT JOIN purchases p ON p.store_id = s.id AND p.deleted_at IS NULL
        WHERE s.deleted_at IS NULL
        GROUP BY s.id
        ORDER BY last_used IS NULL, last_used DESC, s.name COLLATE NOCASE, s.id
        """,
    )
    fun storesByRecentUse(): Flow<List<StoreUseRow>>

    @Query("SELECT * FROM store_branches WHERE store_id = :storeId AND deleted_at IS NULL ORDER BY name COLLATE NOCASE, id")
    fun branches(storeId: String): Flow<List<StoreBranchEntity>>

    /** City of the branch of the latest purchase that had one: new branches default to it (S-14). */
    @Query(
        """
        SELECT b.city FROM purchases p JOIN store_branches b ON b.id = p.branch_id
        WHERE p.deleted_at IS NULL AND b.city IS NOT NULL
        ORDER BY p.purchased_at DESC LIMIT 1
        """,
    )
    suspend fun lastBranchCity(): String?
}
