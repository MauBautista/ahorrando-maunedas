package com.maubautista.maunedas.core.database.dao

import androidx.paging.PagingSource
import androidx.room.ColumnInfo
import androidx.room.Dao
import androidx.room.Query
import androidx.room.RawQuery
import androidx.sqlite.db.SimpleSQLiteQuery
import androidx.sqlite.db.SupportSQLiteQuery
import com.maubautista.maunedas.core.database.entity.BarcodeEntity
import com.maubautista.maunedas.core.database.entity.CategoryEntity
import com.maubautista.maunedas.core.database.entity.ImageEntity
import com.maubautista.maunedas.core.database.entity.PendingUploadEntity
import com.maubautista.maunedas.core.database.entity.PriceObservationEntity
import com.maubautista.maunedas.core.database.entity.ProductEntity
import com.maubautista.maunedas.core.database.entity.ProductTagEntity
import com.maubautista.maunedas.core.database.entity.PurchaseEntity
import com.maubautista.maunedas.core.database.entity.PurchaseItemEntity
import com.maubautista.maunedas.core.database.entity.StoreEntity
import com.maubautista.maunedas.core.database.entity.TagEntity
import com.maubautista.maunedas.core.database.entity.VariantEntity
import kotlinx.coroutines.flow.Flow

/** A product in the catalog list (S-07), with its number of live variants. */
data class CatalogProductRow(
    val id: String,
    val name: String,
    val brand: String?,
    @ColumnInfo(name = "display_unit") val displayUnit: String,
    @ColumnInfo(name = "primary_image_id") val primaryImageId: String?,
    @ColumnInfo(name = "variant_count") val variantCount: Int,
)

/** A price point of a live variant, with what the card shows of it. */
data class CatalogPointRow(
    @ColumnInfo(name = "point_id") val pointId: String,
    val source: String,
    @ColumnInfo(name = "variant_id") val variantId: String,
    @ColumnInfo(name = "variant_label") val variantLabel: String,
    val measure: String,
    @ColumnInfo(name = "store_id") val storeId: String,
    @ColumnInfo(name = "store_name") val storeName: String?,
    @ColumnInfo(name = "observed_at") val observedAt: Long,
    @ColumnInfo(name = "cents_per_base") val centsPerBase: Double,
    @ColumnInfo(name = "effective_unit_cents") val effectiveUnitCents: Long?,
)

/**
 * What to list: [words] already normalized like `products.search_key` (every one must appear, partially),
 * [barcode] a 6–14 digit query that also matches an exact code, a category (with its subcategories) and a tag.
 */
data class CatalogSearch(
    val words: List<String> = emptyList(),
    val barcode: String? = null,
    val categoryId: String? = null,
    val tagId: String? = null,
)

/** The same statement as `GET /v1/products` (03 §7, `apps/api/src/routes/products.ts`), without its cursor. */
object CatalogQuery {
    fun products(search: CatalogSearch): SupportSQLiteQuery {
        val where = mutableListOf("p.deleted_at IS NULL")
        val args = mutableListOf<Any>()
        if (search.words.isNotEmpty() || search.barcode != null) {
            val text = if (search.words.isEmpty()) "0" else search.words.joinToString(" AND ") { args += it; "instr(p.search_key, ?) > 0" }
            val code =
                search.barcode?.let {
                    args += it
                    """ OR EXISTS (SELECT 1 FROM barcodes b JOIN variants v ON v.id = b.variant_id
                                   WHERE v.product_id = p.id AND v.deleted_at IS NULL AND b.deleted_at IS NULL AND b.code = ?)"""
                }.orEmpty()
            where += "(($text)$code)"
        }
        search.categoryId?.let {
            args += it
            where +=
                """p.category_id IN (
                     WITH RECURSIVE tree(id) AS (
                       SELECT ?
                       UNION SELECT c.id FROM categories c JOIN tree ON c.parent_id = tree.id WHERE c.deleted_at IS NULL)
                     SELECT id FROM tree)"""
        }
        search.tagId?.let {
            args += it
            where += "EXISTS (SELECT 1 FROM product_tags pt WHERE pt.product_id = p.id AND pt.deleted_at IS NULL AND pt.tag_id = ?)"
        }
        return SimpleSQLiteQuery(
            """SELECT p.id, p.name, p.brand, p.display_unit, p.primary_image_id,
                      (SELECT count(*) FROM variants v WHERE v.product_id = p.id AND v.deleted_at IS NULL) AS variant_count
               FROM products p WHERE ${where.joinToString(" AND ")}
               ORDER BY p.search_key, p.id""",
            args.toTypedArray(),
        )
    }
}

@Dao
interface CatalogQueryDao {
    /** Pages of [CatalogQuery.products]; a change in the catalog or in any price reloads them. */
    @RawQuery(
        observedEntities = [
            ProductEntity::class, VariantEntity::class, ProductTagEntity::class, BarcodeEntity::class, CategoryEntity::class,
            PurchaseEntity::class, PurchaseItemEntity::class, PriceObservationEntity::class, StoreEntity::class,
            // The thumbnail appears once its upload or import leaves the queue (T-117).
            PendingUploadEntity::class, ImageEntity::class,
        ],
    )
    fun products(query: SupportSQLiteQuery): PagingSource<Int, CatalogProductRow>

    /** Points of the product's live variants observed since [since] (the best-price window). */
    @Query(
        """
        SELECT pp.point_id, pp.source, pp.variant_id, v.label AS variant_label, v.measure, pp.store_id,
               s.name AS store_name, pp.observed_at, pp.cents_per_base, pp.effective_unit_cents
        FROM v_price_points pp
        JOIN variants v ON v.id = pp.variant_id
        LEFT JOIN stores s ON s.id = pp.store_id
        WHERE v.product_id = :productId AND v.deleted_at IS NULL AND pp.observed_at >= :since AND pp.cents_per_base IS NOT NULL
        """,
    )
    suspend fun pricePoints(
        productId: String,
        since: Long,
    ): List<CatalogPointRow>

    /** Every point of the product's live variants, observed: the product page follows new prices (S-08). */
    @Query(
        """
        SELECT pp.point_id, pp.source, pp.variant_id, v.label AS variant_label, v.measure, pp.store_id,
               s.name AS store_name, pp.observed_at, pp.cents_per_base, pp.effective_unit_cents
        FROM v_price_points pp
        JOIN variants v ON v.id = pp.variant_id
        LEFT JOIN stores s ON s.id = pp.store_id
        WHERE v.product_id = :productId AND v.deleted_at IS NULL AND pp.cents_per_base IS NOT NULL
        """,
    )
    fun allPricePoints(productId: String): Flow<List<CatalogPointRow>>

    @Query("SELECT EXISTS (SELECT 1 FROM products WHERE deleted_at IS NULL)")
    fun hasProducts(): Flow<Boolean>

    @Query("SELECT * FROM categories WHERE deleted_at IS NULL ORDER BY sort_order, name, id")
    fun categories(): Flow<List<CategoryEntity>>

    @Query("SELECT * FROM tags WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE, id")
    fun tags(): Flow<List<TagEntity>>
}
