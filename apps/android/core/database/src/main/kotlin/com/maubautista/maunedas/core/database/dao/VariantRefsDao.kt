package com.maubautista.maunedas.core.database.dao

import androidx.room.Dao
import androidx.room.Query
import com.maubautista.maunedas.core.database.entity.AlertRuleEntity
import com.maubautista.maunedas.core.database.entity.ImageEntity
import com.maubautista.maunedas.core.database.entity.PriceObservationEntity
import com.maubautista.maunedas.core.database.entity.PurchaseItemEntity
import com.maubautista.maunedas.core.database.entity.ReceiptAliasEntity

/**
 * Live rows that point to a variant and a member may move to another one: "Usar esa variante" of a barcode
 * conflict (04 §6.5). Web observations and other people's alert rules are left alone (the server forbids them).
 */
@Dao
interface VariantRefsDao {
    @Query("SELECT * FROM purchase_items WHERE variant_id = :variantId AND deleted_at IS NULL")
    suspend fun purchaseItems(variantId: String): List<PurchaseItemEntity>

    @Query("SELECT * FROM price_observations WHERE variant_id = :variantId AND source = 'shelf' AND deleted_at IS NULL")
    suspend fun shelfObservations(variantId: String): List<PriceObservationEntity>

    @Query("SELECT * FROM alert_rules WHERE variant_id = :variantId AND user_id = :userId AND deleted_at IS NULL")
    suspend fun ownAlertRules(
        variantId: String,
        userId: String,
    ): List<AlertRuleEntity>

    @Query("SELECT * FROM receipt_aliases WHERE variant_id = :variantId AND deleted_at IS NULL")
    suspend fun receiptAliases(variantId: String): List<ReceiptAliasEntity>

    @Query("SELECT * FROM images WHERE owner_type = 'variant' AND owner_id = :variantId AND deleted_at IS NULL")
    suspend fun images(variantId: String): List<ImageEntity>
}
