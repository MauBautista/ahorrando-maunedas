package com.maubautista.maunedas.core.database.dao

import androidx.room.ColumnInfo
import androidx.room.Dao
import androidx.room.Query

data class ShelfPlaceRow(
    @ColumnInfo(name = "store_id") val storeId: String,
    @ColumnInfo(name = "branch_id") val branchId: String?,
)

@Dao
interface ShelfDao {
    /** S-13 "recuerda la última": the store and branch of this person's latest shelf price. */
    @Query(
        """
        SELECT store_id, branch_id FROM price_observations
        WHERE source = 'shelf' AND updated_by = :userId AND deleted_at IS NULL
        ORDER BY observed_at DESC, id DESC LIMIT 1
        """,
    )
    suspend fun lastPlace(userId: String): ShelfPlaceRow?
}
