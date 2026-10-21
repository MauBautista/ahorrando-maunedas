// Mirror of the D1 tables of the sync registry (04 §6.1): same table and column names, types and
// nullability. SchemaContractTest compares it with packages/shared/sync-schema.json; a schema change
// updates both in the same change (CLAUDE.md rule 6).
package com.maubautista.maunedas.core.database.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey
import kotlinx.serialization.Serializable

/** `users` (order 5). Mirror of a `down` table: the server writes it, the client only applies pull. */
@Serializable
@Entity(tableName = "users")
data class UserEntity(
    @PrimaryKey val id: String,
    val username: String,
    @ColumnInfo(name = "display_name") val displayName: String,
    val role: String,
    val active: Int,
    @ColumnInfo(name = "updated_at") val updatedAt: Long,
    val version: Long = 0,
)

/** `agent_status` (order 5). Mirror of a `down` table: the server writes it, the client only applies pull. */
@Serializable
@Entity(tableName = "agent_status")
data class AgentStatusEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "last_heartbeat_at") val lastHeartbeatAt: Long? = null,
    @ColumnInfo(name = "agent_version") val agentVersion: String? = null,
    val info: String? = null,
    @ColumnInfo(name = "updated_at") val updatedAt: Long,
    val version: Long = 0,
)

/** `stores` (order 10). Mirror of a `sync` table. */
@Serializable
@Entity(tableName = "stores")
data class StoreEntity(
    @PrimaryKey val id: String,
    val name: String,
    val chain: String? = null,
    val kind: String,
    val website: String? = null,
    val adapter: String? = null,
    @ColumnInfo(name = "default_check_interval_min") val defaultCheckIntervalMin: Long,
    @ColumnInfo(name = "created_at") val createdAt: Long,
    @ColumnInfo(name = "updated_at") val updatedAt: Long,
    @ColumnInfo(name = "deleted_at") val deletedAt: Long? = null,
    @ColumnInfo(name = "updated_by") val updatedBy: String? = null,
    val version: Long = 0,
)

/** `categories` (order 10). Mirror of a `sync` table. */
@Serializable
@Entity(tableName = "categories", indices = [Index("parent_id")])
data class CategoryEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "parent_id") val parentId: String? = null,
    val name: String,
    @ColumnInfo(name = "sort_order") val sortOrder: Long,
    @ColumnInfo(name = "created_at") val createdAt: Long,
    @ColumnInfo(name = "updated_at") val updatedAt: Long,
    @ColumnInfo(name = "deleted_at") val deletedAt: Long? = null,
    @ColumnInfo(name = "updated_by") val updatedBy: String? = null,
    val version: Long = 0,
)

/** `tags` (order 10). Mirror of a `sync` table. */
@Serializable
@Entity(tableName = "tags")
data class TagEntity(
    @PrimaryKey val id: String,
    val name: String,
    @ColumnInfo(name = "created_at") val createdAt: Long,
    @ColumnInfo(name = "updated_at") val updatedAt: Long,
    @ColumnInfo(name = "deleted_at") val deletedAt: Long? = null,
    @ColumnInfo(name = "updated_by") val updatedBy: String? = null,
    val version: Long = 0,
)

/** `store_branches` (order 20). Mirror of a `sync` table. */
@Serializable
@Entity(tableName = "store_branches", indices = [Index("store_id")])
data class StoreBranchEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "store_id") val storeId: String,
    val name: String,
    val city: String? = null,
    val address: String? = null,
    val lat: Double? = null,
    val lng: Double? = null,
    @ColumnInfo(name = "created_at") val createdAt: Long,
    @ColumnInfo(name = "updated_at") val updatedAt: Long,
    @ColumnInfo(name = "deleted_at") val deletedAt: Long? = null,
    @ColumnInfo(name = "updated_by") val updatedBy: String? = null,
    val version: Long = 0,
)

/** `products` (order 20). Mirror of a `sync` table. */
@Serializable
@Entity(tableName = "products", indices = [Index("category_id"), Index("search_key")])
data class ProductEntity(
    @PrimaryKey val id: String,
    val name: String,
    val brand: String? = null,
    @ColumnInfo(name = "category_id") val categoryId: String? = null,
    @ColumnInfo(name = "display_unit") val displayUnit: String,
    val notes: String? = null,
    @ColumnInfo(name = "primary_image_id") val primaryImageId: String? = null,
    @ColumnInfo(name = "search_key") val searchKey: String,
    @ColumnInfo(name = "created_at") val createdAt: Long,
    @ColumnInfo(name = "updated_at") val updatedAt: Long,
    @ColumnInfo(name = "deleted_at") val deletedAt: Long? = null,
    @ColumnInfo(name = "updated_by") val updatedBy: String? = null,
    val version: Long = 0,
)

/** `variants` (order 30). Mirror of a `sync` table. */
@Serializable
@Entity(tableName = "variants", indices = [Index("product_id")])
data class VariantEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "product_id") val productId: String,
    val label: String,
    val measure: String,
    @ColumnInfo(name = "unit_amount") val unitAmount: Double,
    @ColumnInfo(name = "pack_count") val packCount: Long,
    @ColumnInfo(name = "sold_by_weight") val soldByWeight: Int,
    @ColumnInfo(name = "primary_image_id") val primaryImageId: String? = null,
    @ColumnInfo(name = "created_at") val createdAt: Long,
    @ColumnInfo(name = "updated_at") val updatedAt: Long,
    @ColumnInfo(name = "deleted_at") val deletedAt: Long? = null,
    @ColumnInfo(name = "updated_by") val updatedBy: String? = null,
    val version: Long = 0,
)

/** `product_tags` (order 30). Mirror of a `sync` table. */
@Serializable
@Entity(tableName = "product_tags", indices = [Index("product_id"), Index("tag_id")])
data class ProductTagEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "product_id") val productId: String,
    @ColumnInfo(name = "tag_id") val tagId: String,
    @ColumnInfo(name = "created_at") val createdAt: Long,
    @ColumnInfo(name = "updated_at") val updatedAt: Long,
    @ColumnInfo(name = "deleted_at") val deletedAt: Long? = null,
    @ColumnInfo(name = "updated_by") val updatedBy: String? = null,
    val version: Long = 0,
)

/** `barcodes` (order 40). Mirror of a `sync` table. */
@Serializable
@Entity(tableName = "barcodes", indices = [Index("variant_id"), Index("code")])
data class BarcodeEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "variant_id") val variantId: String,
    val code: String,
    val format: String? = null,
    val source: String,
    @ColumnInfo(name = "created_at") val createdAt: Long,
    @ColumnInfo(name = "updated_at") val updatedAt: Long,
    @ColumnInfo(name = "deleted_at") val deletedAt: Long? = null,
    @ColumnInfo(name = "updated_by") val updatedBy: String? = null,
    val version: Long = 0,
)

/** `images` (order 40). Mirror of a `sync` table. */
@Serializable
@Entity(tableName = "images", indices = [Index("owner_id")])
data class ImageEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "owner_type") val ownerType: String,
    @ColumnInfo(name = "owner_id") val ownerId: String,
    val role: String,
    val source: String,
    val license: String? = null,
    val attribution: String? = null,
    @ColumnInfo(name = "source_url") val sourceUrl: String? = null,
    @ColumnInfo(name = "original_key") val originalKey: String? = null,
    @ColumnInfo(name = "selected_processed_id") val selectedProcessedId: String? = null,
    @ColumnInfo(name = "selected_thumb_id") val selectedThumbId: String? = null,
    @ColumnInfo(name = "edit_params") val editParams: String? = null,
    @ColumnInfo(name = "enhance_requested_at") val enhanceRequestedAt: Long? = null,
    @ColumnInfo(name = "created_at") val createdAt: Long,
    @ColumnInfo(name = "updated_at") val updatedAt: Long,
    @ColumnInfo(name = "deleted_at") val deletedAt: Long? = null,
    @ColumnInfo(name = "updated_by") val updatedBy: String? = null,
    val version: Long = 0,
)

/** `listings` (order 40). Mirror of a `sync` table. */
@Serializable
@Entity(tableName = "listings", indices = [Index("variant_id"), Index("store_id"), Index("external_id")])
data class ListingEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "variant_id") val variantId: String,
    @ColumnInfo(name = "store_id") val storeId: String,
    val adapter: String,
    val url: String,
    @ColumnInfo(name = "canonical_url") val canonicalUrl: String? = null,
    @ColumnInfo(name = "external_id") val externalId: String? = null,
    @ColumnInfo(name = "check_interval_min") val checkIntervalMin: Long? = null,
    val active: Int,
    @ColumnInfo(name = "created_at") val createdAt: Long,
    @ColumnInfo(name = "updated_at") val updatedAt: Long,
    @ColumnInfo(name = "deleted_at") val deletedAt: Long? = null,
    @ColumnInfo(name = "updated_by") val updatedBy: String? = null,
    val version: Long = 0,
)

/** `purchases` (order 40). Mirror of a `sync` table. */
@Serializable
@Entity(tableName = "purchases", indices = [Index("store_id"), Index("branch_id"), Index("purchased_at")])
data class PurchaseEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "store_id") val storeId: String,
    @ColumnInfo(name = "branch_id") val branchId: String? = null,
    @ColumnInfo(name = "purchased_at") val purchasedAt: Long,
    val currency: String,
    @ColumnInfo(name = "subtotal_cents") val subtotalCents: Long? = null,
    @ColumnInfo(name = "discount_cents") val discountCents: Long,
    @ColumnInfo(name = "total_cents") val totalCents: Long? = null,
    val source: String,
    val status: String,
    @ColumnInfo(name = "receipt_image_id") val receiptImageId: String? = null,
    val notes: String? = null,
    @ColumnInfo(name = "created_at") val createdAt: Long,
    @ColumnInfo(name = "updated_at") val updatedAt: Long,
    @ColumnInfo(name = "deleted_at") val deletedAt: Long? = null,
    @ColumnInfo(name = "updated_by") val updatedBy: String? = null,
    val version: Long = 0,
)

/** `listing_state` (order 45). Mirror of a `down` table: the server writes it, the client only applies pull. */
@Serializable
@Entity(tableName = "listing_state")
data class ListingStateEntity(
    @PrimaryKey @ColumnInfo(name = "listing_id") val listingId: String,
    @ColumnInfo(name = "last_checked_at") val lastCheckedAt: Long? = null,
    @ColumnInfo(name = "last_status") val lastStatus: String? = null,
    @ColumnInfo(name = "last_error") val lastError: String? = null,
    @ColumnInfo(name = "consecutive_failures") val consecutiveFailures: Long,
    @ColumnInfo(name = "last_price_cents") val lastPriceCents: Long? = null,
    @ColumnInfo(name = "last_list_price_cents") val lastListPriceCents: Long? = null,
    @ColumnInfo(name = "last_in_stock") val lastInStock: Int? = null,
    @ColumnInfo(name = "last_promo_text") val lastPromoText: String? = null,
    @ColumnInfo(name = "check_requested_at") val checkRequestedAt: Long? = null,
    @ColumnInfo(name = "updated_at") val updatedAt: Long,
    val version: Long = 0,
)

/** `image_renditions` (order 50). Mirror of a `sync` table. */
@Serializable
@Entity(tableName = "image_renditions", indices = [Index("image_id")])
data class ImageRenditionEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "image_id") val imageId: String,
    val kind: String,
    val tier: String,
    @ColumnInfo(name = "r2_key") val r2Key: String,
    val width: Long? = null,
    val height: Long? = null,
    val bytes: Long? = null,
    @ColumnInfo(name = "created_at") val createdAt: Long,
    @ColumnInfo(name = "updated_at") val updatedAt: Long,
    @ColumnInfo(name = "deleted_at") val deletedAt: Long? = null,
    @ColumnInfo(name = "updated_by") val updatedBy: String? = null,
    val version: Long = 0,
)

/** `purchase_items` (order 50). Mirror of a `sync` table. */
@Serializable
@Entity(tableName = "purchase_items", indices = [Index("purchase_id"), Index("variant_id")])
data class PurchaseItemEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "purchase_id") val purchaseId: String,
    @ColumnInfo(name = "line_no") val lineNo: Long,
    @ColumnInfo(name = "variant_id") val variantId: String? = null,
    @ColumnInfo(name = "raw_text") val rawText: String? = null,
    val quantity: Double,
    @ColumnInfo(name = "unit_price_cents") val unitPriceCents: Long,
    @ColumnInfo(name = "gross_cents") val grossCents: Long,
    @ColumnInfo(name = "discount_cents") val discountCents: Long,
    @ColumnInfo(name = "final_cents") val finalCents: Long,
    @ColumnInfo(name = "created_at") val createdAt: Long,
    @ColumnInfo(name = "updated_at") val updatedAt: Long,
    @ColumnInfo(name = "deleted_at") val deletedAt: Long? = null,
    @ColumnInfo(name = "updated_by") val updatedBy: String? = null,
    val version: Long = 0,
)

/** `receipt_aliases` (order 50). Mirror of a `sync` table. */
@Serializable
@Entity(tableName = "receipt_aliases", indices = [Index("store_id"), Index("variant_id")])
data class ReceiptAliasEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "store_id") val storeId: String,
    @ColumnInfo(name = "raw_text_norm") val rawTextNorm: String,
    @ColumnInfo(name = "variant_id") val variantId: String,
    @ColumnInfo(name = "created_at") val createdAt: Long,
    @ColumnInfo(name = "updated_at") val updatedAt: Long,
    @ColumnInfo(name = "deleted_at") val deletedAt: Long? = null,
    @ColumnInfo(name = "updated_by") val updatedBy: String? = null,
    val version: Long = 0,
)

/** `price_observations` (order 50). Mirror of a `sync` table. */
@Serializable
@Entity(tableName = "price_observations", indices = [Index("variant_id"), Index("store_id"), Index("branch_id"), Index("listing_id"), Index("observed_at")])
data class PriceObservationEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "variant_id") val variantId: String,
    @ColumnInfo(name = "store_id") val storeId: String,
    @ColumnInfo(name = "branch_id") val branchId: String? = null,
    @ColumnInfo(name = "listing_id") val listingId: String? = null,
    val source: String,
    @ColumnInfo(name = "price_cents") val priceCents: Long,
    @ColumnInfo(name = "list_price_cents") val listPriceCents: Long? = null,
    @ColumnInfo(name = "effective_price_cents") val effectivePriceCents: Long? = null,
    @ColumnInfo(name = "in_stock") val inStock: Int? = null,
    @ColumnInfo(name = "promo_text") val promoText: String? = null,
    val extra: String? = null,
    @ColumnInfo(name = "observed_at") val observedAt: Long,
    @ColumnInfo(name = "photo_image_id") val photoImageId: String? = null,
    @ColumnInfo(name = "created_at") val createdAt: Long,
    @ColumnInfo(name = "updated_at") val updatedAt: Long,
    @ColumnInfo(name = "deleted_at") val deletedAt: Long? = null,
    @ColumnInfo(name = "updated_by") val updatedBy: String? = null,
    val version: Long = 0,
)

/** `alert_rules` (order 50). Mirror of a `sync` table. */
@Serializable
@Entity(tableName = "alert_rules", indices = [Index("user_id"), Index("variant_id"), Index("listing_id")])
data class AlertRuleEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "user_id") val userId: String,
    @ColumnInfo(name = "variant_id") val variantId: String,
    @ColumnInfo(name = "listing_id") val listingId: String? = null,
    val type: String,
    @ColumnInfo(name = "threshold_cents") val thresholdCents: Long? = null,
    @ColumnInfo(name = "threshold_pct") val thresholdPct: Double? = null,
    val scope: String,
    @ColumnInfo(name = "cooldown_hours") val cooldownHours: Long,
    val active: Int,
    @ColumnInfo(name = "created_at") val createdAt: Long,
    @ColumnInfo(name = "updated_at") val updatedAt: Long,
    @ColumnInfo(name = "deleted_at") val deletedAt: Long? = null,
    @ColumnInfo(name = "updated_by") val updatedBy: String? = null,
    val version: Long = 0,
)

/** `alert_events` (order 55). Mirror of a `down` table: the server writes it, the client only applies pull. */
@Serializable
@Entity(tableName = "alert_events", indices = [Index("rule_id"), Index("user_id"), Index("observation_id")])
data class AlertEventEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "rule_id") val ruleId: String,
    @ColumnInfo(name = "user_id") val userId: String,
    @ColumnInfo(name = "observation_id") val observationId: String? = null,
    @ColumnInfo(name = "fired_at") val firedAt: Long,
    val title: String,
    val body: String,
    @ColumnInfo(name = "delivery_status") val deliveryStatus: String,
    val version: Long = 0,
)

/** `promotions` (order 60). Mirror of a `sync` table. */
@Serializable
@Entity(tableName = "promotions", indices = [Index("purchase_id"), Index("purchase_item_id"), Index("observation_id")])
data class PromotionEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "purchase_id") val purchaseId: String? = null,
    @ColumnInfo(name = "purchase_item_id") val purchaseItemId: String? = null,
    @ColumnInfo(name = "observation_id") val observationId: String? = null,
    val type: String,
    val params: String? = null,
    val description: String? = null,
    @ColumnInfo(name = "discount_cents") val discountCents: Long,
    @ColumnInfo(name = "affects_price") val affectsPrice: Int,
    @ColumnInfo(name = "created_at") val createdAt: Long,
    @ColumnInfo(name = "updated_at") val updatedAt: Long,
    @ColumnInfo(name = "deleted_at") val deletedAt: Long? = null,
    @ColumnInfo(name = "updated_by") val updatedBy: String? = null,
    val version: Long = 0,
)
