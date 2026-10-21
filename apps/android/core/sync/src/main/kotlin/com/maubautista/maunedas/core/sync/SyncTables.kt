package com.maubautista.maunedas.core.sync

import com.maubautista.maunedas.core.database.AppDatabase
import com.maubautista.maunedas.core.database.dao.SyncDao
import com.maubautista.maunedas.core.database.entity.AgentStatusEntity
import com.maubautista.maunedas.core.database.entity.AlertEventEntity
import com.maubautista.maunedas.core.database.entity.AlertRuleEntity
import com.maubautista.maunedas.core.database.entity.BarcodeEntity
import com.maubautista.maunedas.core.database.entity.CategoryEntity
import com.maubautista.maunedas.core.database.entity.ImageEntity
import com.maubautista.maunedas.core.database.entity.ImageRenditionEntity
import com.maubautista.maunedas.core.database.entity.ListingEntity
import com.maubautista.maunedas.core.database.entity.ListingStateEntity
import com.maubautista.maunedas.core.database.entity.PriceObservationEntity
import com.maubautista.maunedas.core.database.entity.ProductEntity
import com.maubautista.maunedas.core.database.entity.ProductTagEntity
import com.maubautista.maunedas.core.database.entity.PromotionEntity
import com.maubautista.maunedas.core.database.entity.PurchaseEntity
import com.maubautista.maunedas.core.database.entity.PurchaseItemEntity
import com.maubautista.maunedas.core.database.entity.ReceiptAliasEntity
import com.maubautista.maunedas.core.database.entity.StoreBranchEntity
import com.maubautista.maunedas.core.database.entity.StoreEntity
import com.maubautista.maunedas.core.database.entity.TagEntity
import com.maubautista.maunedas.core.database.entity.UserEntity
import com.maubautista.maunedas.core.database.entity.VariantEntity
import kotlinx.serialization.KSerializer

enum class SyncMode { SYNC, DOWN }

/**
 * One table of the sync registry (04 §2) bound to its Room mirror. `sync` tables are written locally and
 * pushed; `down` tables are only applied from pull, so they have no [stamp] nor [tombstone].
 */
class SyncTable<T : Any>(
    val name: String,
    val mode: SyncMode,
    /** Parents before children, as the server processes them. */
    val order: Int,
    val serializer: KSerializer<T>,
    val dao: (AppDatabase) -> SyncDao<T>,
    val find: suspend (AppDatabase, String) -> T?,
    val id: (T) -> String,
    val updatedAt: ((T) -> Long)? = null,
    val stamp: ((T, Long, String?) -> T)? = null,
    val tombstone: ((T, Long) -> T)? = null,
)

/** Kotlin side of `packages/shared/src/sync/registry.ts`; SyncTablesContractTest compares it with sync-schema.json. */
object SyncTables {
    val all: List<SyncTable<*>> =
        listOf(
            SyncTable(
                name = "users",
                mode = SyncMode.DOWN,
                order = 5,
                serializer = UserEntity.serializer(),
                dao = { it.users() },
                find = { db, id -> db.users().byId(id) },
                id = { it.id },
            ),
            SyncTable(
                name = "agent_status",
                mode = SyncMode.DOWN,
                order = 5,
                serializer = AgentStatusEntity.serializer(),
                dao = { it.agentStatus() },
                find = { db, id -> db.agentStatus().byId(id) },
                id = { it.id },
            ),
            SyncTable(
                name = "stores",
                mode = SyncMode.SYNC,
                order = 10,
                serializer = StoreEntity.serializer(),
                dao = { it.stores() },
                find = { db, id -> db.stores().byId(id) },
                id = { it.id },
                updatedAt = { it.updatedAt },
                stamp = { row, at, by -> row.copy(updatedAt = at, updatedBy = by) },
                tombstone = { row, at -> row.copy(deletedAt = at) },
            ),
            SyncTable(
                name = "categories",
                mode = SyncMode.SYNC,
                order = 10,
                serializer = CategoryEntity.serializer(),
                dao = { it.categories() },
                find = { db, id -> db.categories().byId(id) },
                id = { it.id },
                updatedAt = { it.updatedAt },
                stamp = { row, at, by -> row.copy(updatedAt = at, updatedBy = by) },
                tombstone = { row, at -> row.copy(deletedAt = at) },
            ),
            SyncTable(
                name = "tags",
                mode = SyncMode.SYNC,
                order = 10,
                serializer = TagEntity.serializer(),
                dao = { it.tags() },
                find = { db, id -> db.tags().byId(id) },
                id = { it.id },
                updatedAt = { it.updatedAt },
                stamp = { row, at, by -> row.copy(updatedAt = at, updatedBy = by) },
                tombstone = { row, at -> row.copy(deletedAt = at) },
            ),
            SyncTable(
                name = "store_branches",
                mode = SyncMode.SYNC,
                order = 20,
                serializer = StoreBranchEntity.serializer(),
                dao = { it.storeBranches() },
                find = { db, id -> db.storeBranches().byId(id) },
                id = { it.id },
                updatedAt = { it.updatedAt },
                stamp = { row, at, by -> row.copy(updatedAt = at, updatedBy = by) },
                tombstone = { row, at -> row.copy(deletedAt = at) },
            ),
            SyncTable(
                name = "products",
                mode = SyncMode.SYNC,
                order = 20,
                serializer = ProductEntity.serializer(),
                dao = { it.products() },
                find = { db, id -> db.products().byId(id) },
                id = { it.id },
                updatedAt = { it.updatedAt },
                stamp = { row, at, by -> row.copy(updatedAt = at, updatedBy = by) },
                tombstone = { row, at -> row.copy(deletedAt = at) },
            ),
            SyncTable(
                name = "variants",
                mode = SyncMode.SYNC,
                order = 30,
                serializer = VariantEntity.serializer(),
                dao = { it.variants() },
                find = { db, id -> db.variants().byId(id) },
                id = { it.id },
                updatedAt = { it.updatedAt },
                stamp = { row, at, by -> row.copy(updatedAt = at, updatedBy = by) },
                tombstone = { row, at -> row.copy(deletedAt = at) },
            ),
            SyncTable(
                name = "product_tags",
                mode = SyncMode.SYNC,
                order = 30,
                serializer = ProductTagEntity.serializer(),
                dao = { it.productTags() },
                find = { db, id -> db.productTags().byId(id) },
                id = { it.id },
                updatedAt = { it.updatedAt },
                stamp = { row, at, by -> row.copy(updatedAt = at, updatedBy = by) },
                tombstone = { row, at -> row.copy(deletedAt = at) },
            ),
            SyncTable(
                name = "barcodes",
                mode = SyncMode.SYNC,
                order = 40,
                serializer = BarcodeEntity.serializer(),
                dao = { it.barcodes() },
                find = { db, id -> db.barcodes().byId(id) },
                id = { it.id },
                updatedAt = { it.updatedAt },
                stamp = { row, at, by -> row.copy(updatedAt = at, updatedBy = by) },
                tombstone = { row, at -> row.copy(deletedAt = at) },
            ),
            SyncTable(
                name = "images",
                mode = SyncMode.SYNC,
                order = 40,
                serializer = ImageEntity.serializer(),
                dao = { it.images() },
                find = { db, id -> db.images().byId(id) },
                id = { it.id },
                updatedAt = { it.updatedAt },
                stamp = { row, at, by -> row.copy(updatedAt = at, updatedBy = by) },
                tombstone = { row, at -> row.copy(deletedAt = at) },
            ),
            SyncTable(
                name = "listings",
                mode = SyncMode.SYNC,
                order = 40,
                serializer = ListingEntity.serializer(),
                dao = { it.listings() },
                find = { db, id -> db.listings().byId(id) },
                id = { it.id },
                updatedAt = { it.updatedAt },
                stamp = { row, at, by -> row.copy(updatedAt = at, updatedBy = by) },
                tombstone = { row, at -> row.copy(deletedAt = at) },
            ),
            SyncTable(
                name = "purchases",
                mode = SyncMode.SYNC,
                order = 40,
                serializer = PurchaseEntity.serializer(),
                dao = { it.purchases() },
                find = { db, id -> db.purchases().byId(id) },
                id = { it.id },
                updatedAt = { it.updatedAt },
                stamp = { row, at, by -> row.copy(updatedAt = at, updatedBy = by) },
                tombstone = { row, at -> row.copy(deletedAt = at) },
            ),
            SyncTable(
                name = "listing_state",
                mode = SyncMode.DOWN,
                order = 45,
                serializer = ListingStateEntity.serializer(),
                dao = { it.listingState() },
                find = { db, id -> db.listingState().byId(id) },
                id = { it.listingId },
            ),
            SyncTable(
                name = "image_renditions",
                mode = SyncMode.SYNC,
                order = 50,
                serializer = ImageRenditionEntity.serializer(),
                dao = { it.imageRenditions() },
                find = { db, id -> db.imageRenditions().byId(id) },
                id = { it.id },
                updatedAt = { it.updatedAt },
                stamp = { row, at, by -> row.copy(updatedAt = at, updatedBy = by) },
                tombstone = { row, at -> row.copy(deletedAt = at) },
            ),
            SyncTable(
                name = "purchase_items",
                mode = SyncMode.SYNC,
                order = 50,
                serializer = PurchaseItemEntity.serializer(),
                dao = { it.purchaseItems() },
                find = { db, id -> db.purchaseItems().byId(id) },
                id = { it.id },
                updatedAt = { it.updatedAt },
                stamp = { row, at, by -> row.copy(updatedAt = at, updatedBy = by) },
                tombstone = { row, at -> row.copy(deletedAt = at) },
            ),
            SyncTable(
                name = "receipt_aliases",
                mode = SyncMode.SYNC,
                order = 50,
                serializer = ReceiptAliasEntity.serializer(),
                dao = { it.receiptAliases() },
                find = { db, id -> db.receiptAliases().byId(id) },
                id = { it.id },
                updatedAt = { it.updatedAt },
                stamp = { row, at, by -> row.copy(updatedAt = at, updatedBy = by) },
                tombstone = { row, at -> row.copy(deletedAt = at) },
            ),
            SyncTable(
                name = "price_observations",
                mode = SyncMode.SYNC,
                order = 50,
                serializer = PriceObservationEntity.serializer(),
                dao = { it.priceObservations() },
                find = { db, id -> db.priceObservations().byId(id) },
                id = { it.id },
                updatedAt = { it.updatedAt },
                stamp = { row, at, by -> row.copy(updatedAt = at, updatedBy = by) },
                tombstone = { row, at -> row.copy(deletedAt = at) },
            ),
            SyncTable(
                name = "alert_rules",
                mode = SyncMode.SYNC,
                order = 50,
                serializer = AlertRuleEntity.serializer(),
                dao = { it.alertRules() },
                find = { db, id -> db.alertRules().byId(id) },
                id = { it.id },
                updatedAt = { it.updatedAt },
                stamp = { row, at, by -> row.copy(updatedAt = at, updatedBy = by) },
                tombstone = { row, at -> row.copy(deletedAt = at) },
            ),
            SyncTable(
                name = "alert_events",
                mode = SyncMode.DOWN,
                order = 55,
                serializer = AlertEventEntity.serializer(),
                dao = { it.alertEvents() },
                find = { db, id -> db.alertEvents().byId(id) },
                id = { it.id },
            ),
            SyncTable(
                name = "promotions",
                mode = SyncMode.SYNC,
                order = 60,
                serializer = PromotionEntity.serializer(),
                dao = { it.promotions() },
                find = { db, id -> db.promotions().byId(id) },
                id = { it.id },
                updatedAt = { it.updatedAt },
                stamp = { row, at, by -> row.copy(updatedAt = at, updatedBy = by) },
                tombstone = { row, at -> row.copy(deletedAt = at) },
            ),
        ).sortedBy { it.order }

    private val byName = all.associateBy { it.name }

    fun named(name: String): SyncTable<*>? = byName[name]

    /** Typed lookup for writers: `SyncTables.of<ProductEntity>("products")`. */
    @Suppress("UNCHECKED_CAST")
    fun <T : Any> of(name: String): SyncTable<T> = byName.getValue(name) as SyncTable<T>
}
