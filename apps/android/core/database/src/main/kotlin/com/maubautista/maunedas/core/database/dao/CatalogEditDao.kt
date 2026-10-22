package com.maubautista.maunedas.core.database.dao

import androidx.room.ColumnInfo
import androidx.room.Dao
import androidx.room.Query
import com.maubautista.maunedas.core.database.entity.TagEntity
import com.maubautista.maunedas.core.database.entity.VariantEntity
import kotlinx.coroutines.flow.Flow

/** The live variant a barcode belongs to, as the editor names it. */
data class BarcodeOwnerRow(
    @ColumnInfo(name = "variant_id") val variantId: String,
    @ColumnInfo(name = "variant_label") val variantLabel: String,
    @ColumnInfo(name = "product_name") val productName: String,
)

/** Reads the product and variant editors need (S-09, S-10); writes go through LocalWriter. */
@Dao
interface CatalogEditDao {
    @Query(
        """
        SELECT b.variant_id, v.label AS variant_label, p.name AS product_name
        FROM barcodes b JOIN variants v ON v.id = b.variant_id JOIN products p ON p.id = v.product_id
        WHERE b.code = :code AND b.deleted_at IS NULL
        LIMIT 1
        """,
    )
    suspend fun barcodeOwner(code: String): BarcodeOwnerRow?

    @Query("SELECT tag_id FROM product_tags WHERE product_id = :productId AND deleted_at IS NULL")
    suspend fun liveTagIds(productId: String): List<String>

    @Query("SELECT * FROM tags WHERE deleted_at IS NULL")
    suspend fun liveTags(): List<TagEntity>

    @Query("SELECT * FROM variants WHERE product_id = :productId AND deleted_at IS NULL ORDER BY label, id")
    fun liveVariantsOf(productId: String): Flow<List<VariantEntity>>
}
