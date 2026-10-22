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
