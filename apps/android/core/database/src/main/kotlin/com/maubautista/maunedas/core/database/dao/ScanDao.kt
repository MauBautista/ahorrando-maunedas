package com.maubautista.maunedas.core.database.dao

import androidx.room.ColumnInfo
import androidx.room.Dao
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

/** The live variant (of a live product) a scanned code belongs to. */
data class ScanHitRow(
    @ColumnInfo(name = "variant_id") val variantId: String,
    @ColumnInfo(name = "product_id") val productId: String,
    @ColumnInfo(name = "product_name") val productName: String,
    @ColumnInfo(name = "variant_label") val variantLabel: String,
    val brand: String?,
)

/** The newest open draft: "Agregar a la compra abierta" (S-12). */
data class OpenDraftRow(
    val id: String,
    @ColumnInfo(name = "store_name") val storeName: String?,
)

@Dao
interface ScanDao {
    /** Observed: a code that is on the server but not here yet appears when the pull brings it (S-12). */
    @Query(
        """
        SELECT b.variant_id, v.product_id, p.name AS product_name, v.label AS variant_label, p.brand
        FROM barcodes b JOIN variants v ON v.id = b.variant_id JOIN products p ON p.id = v.product_id
        WHERE b.code = :code AND b.deleted_at IS NULL AND v.deleted_at IS NULL AND p.deleted_at IS NULL
        LIMIT 1
        """,
    )
    fun hit(code: String): Flow<ScanHitRow?>

    @Query(
        """
        SELECT p.id, s.name AS store_name FROM purchases p LEFT JOIN stores s ON s.id = p.store_id
        WHERE p.deleted_at IS NULL AND p.status = 'draft'
        ORDER BY p.updated_at DESC, p.id DESC LIMIT 1
        """,
    )
    fun openDraft(): Flow<OpenDraftRow?>
}
