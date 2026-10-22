package com.maubautista.maunedas.core.database.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import androidx.room.Upsert
import com.maubautista.maunedas.core.database.entity.OutboxEntry
import com.maubautista.maunedas.core.database.entity.PendingUploadEntity
import com.maubautista.maunedas.core.database.entity.SyncCursorEntity
import com.maubautista.maunedas.core.database.entity.SyncIssueEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface OutboxDao {
    /** REPLACE: a row edited again keeps one entry, with the new time and a new place in the queue (04 §4.4). */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun enqueueAll(entries: List<OutboxEntry>)

    /**
     * Entries enqueued before [enqueuedBefore], parents before children (the `order` of the sync registry,
     * so a push never sends a row before the one it references), then by queue order.
     */
    @Query(
        """
        SELECT * FROM outbox WHERE enqueued_at <= :enqueuedBefore
        ORDER BY CASE table_name
                    WHEN 'stores' THEN 10
                    WHEN 'categories' THEN 10
                    WHEN 'tags' THEN 10
                    WHEN 'store_branches' THEN 20
                    WHEN 'products' THEN 20
                    WHEN 'variants' THEN 30
                    WHEN 'product_tags' THEN 30
                    WHEN 'barcodes' THEN 40
                    WHEN 'images' THEN 40
                    WHEN 'listings' THEN 40
                    WHEN 'purchases' THEN 40
                    WHEN 'image_renditions' THEN 50
                    WHEN 'purchase_items' THEN 50
                    WHEN 'receipt_aliases' THEN 50
                    WHEN 'price_observations' THEN 50
                    WHEN 'alert_rules' THEN 50
                    WHEN 'promotions' THEN 60
                    ELSE 1000 END,
                 seq
        LIMIT :limit
        """,
    )
    suspend fun nextBatch(
        limit: Int,
        enqueuedBefore: Long,
    ): List<OutboxEntry>

    /** Removes an entry only if it was not re-enqueued meanwhile (an edit during the push). */
    @Query("DELETE FROM outbox WHERE seq = :seq AND enqueued_at = :enqueuedAt")
    suspend fun removeIfUnchanged(
        seq: Long,
        enqueuedAt: Long,
    )

    @Transaction
    suspend fun removeIfUnchanged(entries: List<OutboxEntry>) = entries.forEach { removeIfUnchanged(it.seq, it.enqueuedAt) }

    @Query("SELECT count(*) FROM outbox")
    suspend fun count(): Int

    @Query("SELECT count(*) FROM outbox")
    fun observeCount(): Flow<Int>

    /** A local change of that row is waiting to be pushed (04 §6.4). */
    @Query("SELECT EXISTS (SELECT 1 FROM outbox WHERE table_name = :tableName AND row_id = :rowId)")
    suspend fun contains(
        tableName: String,
        rowId: String,
    ): Boolean

    /** Drops entries for good: a row that no longer exists locally or one the server rejected on its own. */
    @Query("DELETE FROM outbox WHERE seq IN (:seqs)")
    suspend fun remove(seqs: List<Long>)
}

@Dao
interface PendingUploadDao {
    /** The same blob is queued once (unique `(image_id, name)`). */
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun enqueue(upload: PendingUploadEntity): Long

    @Query("SELECT * FROM pending_uploads ORDER BY created_at, id LIMIT :limit")
    suspend fun next(limit: Int): List<PendingUploadEntity>

    @Query("UPDATE pending_uploads SET attempts = attempts + 1, last_error = :error WHERE id = :id")
    suspend fun markFailed(
        id: Long,
        error: String,
    )

    @Query("DELETE FROM pending_uploads WHERE id = :id")
    suspend fun remove(id: Long)

    @Query("SELECT count(*) FROM pending_uploads")
    suspend fun count(): Int

    @Query("SELECT count(*) FROM pending_uploads")
    fun observeCount(): Flow<Int>
}

@Dao
interface SyncCursorDao {
    @Query("SELECT * FROM sync_cursors")
    suspend fun all(): List<SyncCursorEntity>

    @Upsert
    suspend fun saveAll(cursors: List<SyncCursorEntity>)
}

@Dao
interface SyncIssueDao {
    @Insert
    suspend fun add(issue: SyncIssueEntity): Long

    @Query("SELECT * FROM sync_issues WHERE resolved_at IS NULL ORDER BY created_at, id")
    suspend fun unresolved(): List<SyncIssueEntity>

    @Query("SELECT count(*) FROM sync_issues WHERE resolved_at IS NULL")
    fun observeUnresolvedCount(): Flow<Int>

    @Query("UPDATE sync_issues SET resolved_at = :at WHERE id = :id")
    suspend fun resolve(
        id: Long,
        at: Long,
    )
}

@Dao
interface PricePointDao {
    /** Every price point of a variant, oldest first (history, 03 §7). */
    @Query("SELECT * FROM v_price_points WHERE variant_id = :variantId ORDER BY observed_at, point_id")
    suspend fun forVariant(variantId: String): List<com.maubautista.maunedas.core.database.entity.PricePointView>
}
