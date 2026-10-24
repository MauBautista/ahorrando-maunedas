package com.maubautista.maunedas.core.database

import androidx.room.Database
import androidx.room.RoomDatabase
import com.maubautista.maunedas.core.database.dao.*
import com.maubautista.maunedas.core.database.entity.*

/**
 * The local database (04 §6.1): mirrors of the sync and down tables, local tables and `v_price_points`.
 * No foreign keys (rows arrive in any order; the server checks integrity). The schema is exported to
 * `schemas/` and every version change needs a migration (CLAUDE.md rule 6).
 */
@Database(
    version = 1,
    exportSchema = true,
    entities = [
        UserEntity::class,
        AgentStatusEntity::class,
        StoreEntity::class,
        CategoryEntity::class,
        TagEntity::class,
        StoreBranchEntity::class,
        ProductEntity::class,
        VariantEntity::class,
        ProductTagEntity::class,
        BarcodeEntity::class,
        ImageEntity::class,
        ListingEntity::class,
        PurchaseEntity::class,
        ListingStateEntity::class,
        ImageRenditionEntity::class,
        PurchaseItemEntity::class,
        ReceiptAliasEntity::class,
        PriceObservationEntity::class,
        AlertRuleEntity::class,
        AlertEventEntity::class,
        PromotionEntity::class,
        OutboxEntry::class,
        PendingUploadEntity::class,
        SyncCursorEntity::class,
        SyncIssueEntity::class,
    ],
    views = [PricePointView::class],
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun users(): UserDao
    abstract fun agentStatus(): AgentStatusDao
    abstract fun stores(): StoreDao
    abstract fun categories(): CategoryDao
    abstract fun tags(): TagDao
    abstract fun storeBranches(): StoreBranchDao
    abstract fun products(): ProductDao
    abstract fun variants(): VariantDao
    abstract fun productTags(): ProductTagDao
    abstract fun barcodes(): BarcodeDao
    abstract fun images(): ImageDao
    abstract fun listings(): ListingDao
    abstract fun purchases(): PurchaseDao
    abstract fun listingState(): ListingStateDao
    abstract fun imageRenditions(): ImageRenditionDao
    abstract fun purchaseItems(): PurchaseItemDao
    abstract fun receiptAliases(): ReceiptAliasDao
    abstract fun priceObservations(): PriceObservationDao
    abstract fun alertRules(): AlertRuleDao
    abstract fun alertEvents(): AlertEventDao
    abstract fun promotions(): PromotionDao

    abstract fun outbox(): OutboxDao

    abstract fun pendingUploads(): PendingUploadDao

    abstract fun syncCursors(): SyncCursorDao

    abstract fun syncIssues(): SyncIssueDao

    abstract fun pricePoints(): PricePointDao

    abstract fun purchaseQueries(): PurchaseQueryDao

    abstract fun catalogQueries(): CatalogQueryDao

    abstract fun catalogEdits(): CatalogEditDao

    abstract fun productPage(): ProductPageDao

    abstract fun purchaseEdits(): PurchaseEditDao

    abstract fun variantRefs(): VariantRefsDao

    abstract fun scan(): ScanDao

    companion object {
        const val NAME = "maunedas.db"
    }
}
