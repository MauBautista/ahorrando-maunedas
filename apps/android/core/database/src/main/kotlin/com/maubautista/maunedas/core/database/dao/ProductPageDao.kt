package com.maubautista.maunedas.core.database.dao

import androidx.room.ColumnInfo
import androidx.room.Dao
import androidx.room.Query
import com.maubautista.maunedas.core.database.entity.BarcodeEntity
import com.maubautista.maunedas.core.database.entity.ProductEntity
import com.maubautista.maunedas.core.database.entity.TagEntity
import kotlinx.coroutines.flow.Flow

/** A live product or variant someone can merge into (RF-CAT-07); [searchKey] is the product's. */
data class MergeCandidateRow(
    val id: String,
    val name: String,
    val detail: String?,
    @ColumnInfo(name = "search_key") val searchKey: String,
)

/** A point of a variant's price history (RF-PRE-02), as `GET /v1/variants/:id/history` lists it. */
data class HistoryPointRow(
    @ColumnInfo(name = "point_id") val pointId: String,
    val source: String,
    @ColumnInfo(name = "store_id") val storeId: String,
    @ColumnInfo(name = "store_name") val storeName: String?,
    @ColumnInfo(name = "observed_at") val observedAt: Long,
    @ColumnInfo(name = "list_unit_cents") val listUnitCents: Long,
    @ColumnInfo(name = "effective_unit_cents") val effectiveUnitCents: Long?,
    @ColumnInfo(name = "cents_per_base") val centsPerBase: Double,
    @ColumnInfo(name = "has_promo") val hasPromo: Boolean,
    val measure: String,
)

/** What the product page (S-08) observes; prices come from [CatalogQueryDao.allPricePoints]. */
@Dao
interface ProductPageDao {
    @Query("SELECT * FROM products WHERE id = :id AND deleted_at IS NULL")
    fun product(id: String): Flow<ProductEntity?>

    /** As `GET /v1/products/:id`: live links to live tags, by name. */
    @Query(
        """
        SELECT t.* FROM product_tags pt JOIN tags t ON t.id = pt.tag_id
        WHERE pt.product_id = :productId AND pt.deleted_at IS NULL AND t.deleted_at IS NULL
        ORDER BY t.name, t.id
        """,
    )
    fun tags(productId: String): Flow<List<TagEntity>>

    @Query(
        """
        SELECT b.* FROM barcodes b JOIN variants v ON v.id = b.variant_id
        WHERE v.product_id = :productId AND v.deleted_at IS NULL AND b.deleted_at IS NULL
        ORDER BY b.code
        """,
    )
    fun barcodes(productId: String): Flow<List<BarcodeEntity>>

    /** Every point of a variant, oldest first (the history filters them by period, source and store). */
    @Query(
        """
        SELECT pp.point_id, pp.source, pp.store_id, s.name AS store_name, pp.observed_at, pp.list_unit_cents,
               pp.effective_unit_cents, pp.cents_per_base, pp.has_promo, v.measure
        FROM v_price_points pp JOIN variants v ON v.id = pp.variant_id LEFT JOIN stores s ON s.id = pp.store_id
        WHERE pp.variant_id = :variantId AND pp.cents_per_base IS NOT NULL
        ORDER BY pp.observed_at, pp.point_id
        """,
    )
    fun variantPoints(variantId: String): Flow<List<HistoryPointRow>>

    /** Other live products, to merge [exceptId] into one of them. */
    @Query("SELECT id, name, brand AS detail, search_key FROM products WHERE deleted_at IS NULL AND id != :exceptId ORDER BY search_key, id")
    fun otherProducts(exceptId: String): Flow<List<MergeCandidateRow>>

    /** Other live variants of the same measure (the server refuses mixing them), with their product's name. */
    @Query(
        """
        SELECT v.id, p.name, v.label AS detail, p.search_key FROM variants v JOIN products p ON p.id = v.product_id
        WHERE v.deleted_at IS NULL AND p.deleted_at IS NULL AND v.measure = :measure AND v.id != :exceptId
        ORDER BY p.search_key, v.label, v.id
        """,
    )
    fun otherVariants(
        exceptId: String,
        measure: String,
    ): Flow<List<MergeCandidateRow>>
}
