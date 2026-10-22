package com.maubautista.maunedas.core.database.dao

import androidx.paging.PagingSource
import androidx.room.ColumnInfo
import androidx.room.Dao
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

/** A purchase as lists show it: store, branch, date, total and number of live lines. */
data class PurchaseSummaryRow(
    val id: String,
    @ColumnInfo(name = "purchased_at") val purchasedAt: Long,
    val status: String,
    @ColumnInfo(name = "store_name") val storeName: String?,
    @ColumnInfo(name = "branch_name") val branchName: String?,
    @ColumnInfo(name = "total_cents") val totalCents: Long,
    @ColumnInfo(name = "line_count") val lineCount: Int,
)

/** A store to filter purchases by. */
data class StoreOptionRow(
    val id: String,
    val name: String,
)

/**
 * Read-only purchase queries for the screens. The total of a purchase is its ticket total, or without one
 * Σ final_cents of the live lines − the ticket discount, never below zero (RF-COM-06, 05 §5 S-02).
 */
@Dao
interface PurchaseQueryDao {
    /** Newest first; drafts included. Deleted stores and branches keep their name. */
    @Query(
        """
        SELECT p.id, p.purchased_at, p.status, s.name AS store_name, b.name AS branch_name,
               COALESCE(p.total_cents, MAX(0, COALESCE(l.lines_cents, 0) - p.discount_cents)) AS total_cents,
               COALESCE(l.line_count, 0) AS line_count
        FROM purchases p
        LEFT JOIN stores s ON s.id = p.store_id
        LEFT JOIN store_branches b ON b.id = p.branch_id
        LEFT JOIN (SELECT purchase_id, SUM(final_cents) AS lines_cents, COUNT(*) AS line_count
                   FROM purchase_items WHERE deleted_at IS NULL GROUP BY purchase_id) l ON l.purchase_id = p.id
        WHERE p.deleted_at IS NULL
        ORDER BY p.purchased_at DESC, p.id DESC
        LIMIT :limit
        """,
    )
    fun recent(limit: Int): Flow<List<PurchaseSummaryRow>>

    /** Spent in confirmed purchases with `from <= purchased_at < until`. */
    @Query(
        """
        SELECT COALESCE(SUM(COALESCE(p.total_cents, MAX(0, COALESCE(l.lines_cents, 0) - p.discount_cents))), 0)
        FROM purchases p
        LEFT JOIN (SELECT purchase_id, SUM(final_cents) AS lines_cents
                   FROM purchase_items WHERE deleted_at IS NULL GROUP BY purchase_id) l ON l.purchase_id = p.id
        WHERE p.deleted_at IS NULL AND p.status = 'confirmed' AND p.purchased_at >= :from AND p.purchased_at < :until
        """,
    )
    fun spent(
        from: Long,
        until: Long,
    ): Flow<Long>

    @Query("SELECT count(*) FROM purchases WHERE deleted_at IS NULL AND status = 'draft'")
    fun openDrafts(): Flow<Int>

    /**
     * S-03 (05 §5): newest first, like `GET /v1/purchases`; a null [storeId] or [status] does not filter, and
     * `from <= purchased_at <= to`.
     */
    @Query(
        """
        SELECT p.id, p.purchased_at, p.status, s.name AS store_name, b.name AS branch_name,
               COALESCE(p.total_cents, MAX(0, COALESCE(l.lines_cents, 0) - p.discount_cents)) AS total_cents,
               COALESCE(l.line_count, 0) AS line_count
        FROM purchases p
        LEFT JOIN stores s ON s.id = p.store_id
        LEFT JOIN store_branches b ON b.id = p.branch_id
        LEFT JOIN (SELECT purchase_id, SUM(final_cents) AS lines_cents, COUNT(*) AS line_count
                   FROM purchase_items WHERE deleted_at IS NULL GROUP BY purchase_id) l ON l.purchase_id = p.id
        WHERE p.deleted_at IS NULL
          AND (:storeId IS NULL OR p.store_id = :storeId)
          AND (:status IS NULL OR p.status = :status)
          AND p.purchased_at BETWEEN :from AND :to
        ORDER BY p.purchased_at DESC, p.id DESC
        """,
    )
    fun page(
        storeId: String?,
        status: String?,
        from: Long,
        to: Long,
    ): PagingSource<Int, PurchaseSummaryRow>

    /** Stores that have live purchases, by name (the store filter of S-03). */
    @Query(
        """
        SELECT DISTINCT s.id, s.name FROM purchases p JOIN stores s ON s.id = p.store_id
        WHERE p.deleted_at IS NULL ORDER BY s.name COLLATE NOCASE, s.id
        """,
    )
    fun storesWithPurchases(): Flow<List<StoreOptionRow>>

    @Query("SELECT EXISTS (SELECT 1 FROM purchases WHERE deleted_at IS NULL)")
    fun hasPurchases(): Flow<Boolean>
}
