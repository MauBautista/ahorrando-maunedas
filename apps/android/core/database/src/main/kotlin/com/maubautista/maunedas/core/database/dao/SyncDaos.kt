package com.maubautista.maunedas.core.database.dao

import androidx.room.Dao
import androidx.room.Query
import com.maubautista.maunedas.core.database.entity.*
import kotlinx.coroutines.flow.Flow

@Dao
interface UserDao : SyncDao<UserEntity> {
    @Query("SELECT * FROM users WHERE id = :id")
    suspend fun byId(id: String): UserEntity?
}

@Dao
interface AgentStatusDao : SyncDao<AgentStatusEntity> {
    @Query("SELECT * FROM agent_status WHERE id = :id")
    suspend fun byId(id: String): AgentStatusEntity?
}

@Dao
interface StoreDao : SyncDao<StoreEntity> {
    @Query("SELECT * FROM stores WHERE id = :id")
    suspend fun byId(id: String): StoreEntity?
}

@Dao
interface CategoryDao : SyncDao<CategoryEntity> {
    @Query("SELECT * FROM categories WHERE id = :id")
    suspend fun byId(id: String): CategoryEntity?
}

@Dao
interface TagDao : SyncDao<TagEntity> {
    @Query("SELECT * FROM tags WHERE id = :id")
    suspend fun byId(id: String): TagEntity?
}

@Dao
interface StoreBranchDao : SyncDao<StoreBranchEntity> {
    @Query("SELECT * FROM store_branches WHERE id = :id")
    suspend fun byId(id: String): StoreBranchEntity?
}

@Dao
interface ProductDao : SyncDao<ProductEntity> {
    @Query("SELECT * FROM products WHERE id = :id")
    suspend fun byId(id: String): ProductEntity?
}

@Dao
interface VariantDao : SyncDao<VariantEntity> {
    @Query("SELECT * FROM variants WHERE id = :id")
    suspend fun byId(id: String): VariantEntity?

    @Query("SELECT * FROM variants WHERE product_id IN (:productIds) AND deleted_at IS NULL")
    suspend fun liveOfProducts(productIds: List<String>): List<VariantEntity>
}

@Dao
interface ProductTagDao : SyncDao<ProductTagEntity> {
    @Query("SELECT * FROM product_tags WHERE id = :id")
    suspend fun byId(id: String): ProductTagEntity?
}

@Dao
interface BarcodeDao : SyncDao<BarcodeEntity> {
    @Query("SELECT * FROM barcodes WHERE id = :id")
    suspend fun byId(id: String): BarcodeEntity?

    @Query("SELECT * FROM barcodes WHERE variant_id IN (:variantIds) AND deleted_at IS NULL")
    suspend fun liveOfVariants(variantIds: List<String>): List<BarcodeEntity>
}

@Dao
interface ImageDao : SyncDao<ImageEntity> {
    @Query("SELECT * FROM images WHERE id = :id")
    suspend fun byId(id: String): ImageEntity?

    @Query("SELECT * FROM images WHERE owner_type = :ownerType AND owner_id = :ownerId AND role = :role AND deleted_at IS NULL")
    suspend fun liveOf(
        ownerType: String,
        ownerId: String,
        role: String,
    ): List<ImageEntity>

    /** A purchase's receipt pages in page order (03 §7: `receipt_images` by `created_at`). */
    @Query("SELECT * FROM images WHERE owner_type = 'purchase' AND owner_id = :purchaseId AND role = 'receipt' AND deleted_at IS NULL ORDER BY created_at, id")
    fun receiptPages(purchaseId: String): Flow<List<ImageEntity>>
}

@Dao
interface ListingDao : SyncDao<ListingEntity> {
    @Query("SELECT * FROM listings WHERE id = :id")
    suspend fun byId(id: String): ListingEntity?

    @Query("SELECT * FROM listings WHERE variant_id IN (:variantIds) AND deleted_at IS NULL")
    suspend fun liveOfVariants(variantIds: List<String>): List<ListingEntity>
}

@Dao
interface PurchaseDao : SyncDao<PurchaseEntity> {
    @Query("SELECT * FROM purchases WHERE id = :id")
    suspend fun byId(id: String): PurchaseEntity?
}

@Dao
interface ListingStateDao : SyncDao<ListingStateEntity> {
    @Query("SELECT * FROM listing_state WHERE listing_id = :id")
    suspend fun byId(id: String): ListingStateEntity?
}

@Dao
interface ImageRenditionDao : SyncDao<ImageRenditionEntity> {
    @Query("SELECT * FROM image_renditions WHERE id = :id")
    suspend fun byId(id: String): ImageRenditionEntity?
}

@Dao
interface PurchaseItemDao : SyncDao<PurchaseItemEntity> {
    @Query("SELECT * FROM purchase_items WHERE id = :id")
    suspend fun byId(id: String): PurchaseItemEntity?

    @Query("SELECT * FROM purchase_items WHERE purchase_id = :purchaseId AND deleted_at IS NULL")
    suspend fun liveOfPurchase(purchaseId: String): List<PurchaseItemEntity>
}

@Dao
interface ReceiptAliasDao : SyncDao<ReceiptAliasEntity> {
    @Query("SELECT * FROM receipt_aliases WHERE id = :id")
    suspend fun byId(id: String): ReceiptAliasEntity?
}

@Dao
interface PriceObservationDao : SyncDao<PriceObservationEntity> {
    @Query("SELECT * FROM price_observations WHERE id = :id")
    suspend fun byId(id: String): PriceObservationEntity?
}

@Dao
interface AlertRuleDao : SyncDao<AlertRuleEntity> {
    @Query("SELECT * FROM alert_rules WHERE id = :id")
    suspend fun byId(id: String): AlertRuleEntity?

    @Query("SELECT * FROM alert_rules WHERE variant_id IN (:variantIds) AND deleted_at IS NULL")
    suspend fun liveOfVariants(variantIds: List<String>): List<AlertRuleEntity>
}

@Dao
interface AlertEventDao : SyncDao<AlertEventEntity> {
    @Query("SELECT * FROM alert_events WHERE id = :id")
    suspend fun byId(id: String): AlertEventEntity?
}

@Dao
interface PromotionDao : SyncDao<PromotionEntity> {
    @Query("SELECT * FROM promotions WHERE id = :id")
    suspend fun byId(id: String): PromotionEntity?

    /** Live promotions of a purchase or of any of its lines (cascade, 04 §6.2). */
    @Query(
        "SELECT * FROM promotions WHERE deleted_at IS NULL AND (purchase_id = :purchaseId OR purchase_item_id IN (:itemIds))",
    )
    suspend fun liveOfPurchaseOrItems(
        purchaseId: String?,
        itemIds: List<String>,
    ): List<PromotionEntity>
}
