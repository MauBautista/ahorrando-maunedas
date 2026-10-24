package com.maubautista.maunedas.core.data

import androidx.room.withTransaction
import com.maubautista.maunedas.core.database.AppDatabase
import com.maubautista.maunedas.core.database.dao.LineVariantRow
import com.maubautista.maunedas.core.database.entity.PromotionEntity
import com.maubautista.maunedas.core.database.entity.PurchaseEntity
import com.maubautista.maunedas.core.database.entity.PurchaseItemEntity
import com.maubautista.maunedas.core.database.entity.StoreBranchEntity
import com.maubautista.maunedas.core.database.entity.StoreEntity
import com.maubautista.maunedas.core.model.Clock
import com.maubautista.maunedas.core.model.DisplayUnit
import com.maubautista.maunedas.core.model.Measure
import com.maubautista.maunedas.core.model.Uuids
import com.maubautista.maunedas.core.pricing.LineAmounts
import com.maubautista.maunedas.core.pricing.PromoParams
import com.maubautista.maunedas.core.pricing.PromoType
import com.maubautista.maunedas.core.pricing.PurchaseMath
import com.maubautista.maunedas.core.pricing.SearchKey
import com.maubautista.maunedas.core.pricing.Units
import com.maubautista.maunedas.core.sync.LocalWriter
import com.maubautista.maunedas.core.sync.SyncTables
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

/** The variant a purchase line points to, with what the line shows and computes. */
data class LineVariant(
    val id: String,
    val productId: String,
    val productName: String,
    val label: String,
    val brand: String?,
    val measure: Measure,
    val unitAmount: Double,
    val packCount: Int,
    val soldByWeight: Boolean,
    val displayUnit: DisplayUnit,
) {
    /** The product's unit, or the default one of the variant's measure when they differ (03 §3). */
    val unit: DisplayUnit get() = if (displayUnit.measure == measure) displayUnit else Units.defaultDisplayUnit(measure)
}

/** Why a line was cheaper (09 §6.1); [discountCents] is computed by `Promotions.discount` or typed by hand. */
data class LinePromotion(
    val id: String? = null,
    val type: PromoType,
    val params: PromoParams,
    val discountCents: Long,
    val description: String? = null,
) {
    /** MSI is recorded but does not change the price (RF-COM-03). */
    val affectsPrice: Boolean get() = type != PromoType.MSI
}

data class PurchaseLine(
    val id: String? = null,
    val variant: LineVariant?,
    val rawText: String? = null,
    val quantity: Double,
    val unitPriceCents: Long,
    val promotion: LinePromotion? = null,
) {
    val amounts: LineAmounts get() = PurchaseMath.line(quantity, unitPriceCents, promotion?.discountCents, promotion?.affectsPrice ?: true)

    /** What was paid per display unit before the ticket discount ("$26.50/L" in S-04); null without a variant. */
    fun perUnitCents(): Long? {
        val v = variant ?: return null
        if (quantity <= 0) return null
        return Units.displayCents(Units.centsPerBase(amounts.finalCents.toDouble(), quantity, v.unitAmount, v.packCount), v.measure, v.unit)
    }
}

/** A discount of the whole ticket (RF-COM-05): a promotion of the purchase; their sum is `purchases.discount_cents`. */
data class TicketDiscount(
    val id: String? = null,
    val description: String,
    val amountCents: Long,
)

data class PurchaseDraft(
    val id: String? = null,
    val storeId: String? = null,
    val branchId: String? = null,
    val purchasedAt: Long,
    val lines: List<PurchaseLine> = emptyList(),
    val ticketDiscounts: List<TicketDiscount> = emptyList(),
    /** "Total del ticket" as typed (RF-COM-06). */
    val ticketTotalCents: Long? = null,
    val confirmed: Boolean = false,
    val source: String = "manual",
    val notes: String? = null,
)

/** A variant found for a line, with its latest list price at the purchase's store (S-05). */
data class VariantChoice(
    val variant: LineVariant,
    val lastPriceCents: Long?,
)

data class StoreChoice(
    val id: String,
    val name: String,
)

data class BranchChoice(
    val id: String,
    val name: String,
    val city: String?,
)

/**
 * The purchase editor's reads and writes (S-04, S-05, S-14). A save writes the purchase, its lines (numbered in
 * order, `final = gross − discount`), one promotion per discounted line and one per ticket discount in a single
 * transaction through [LocalWriter]; lines and discounts that are gone are tombstoned with their cascades (04 §6.2).
 */
@Singleton
class PurchaseEditor
    @Inject
    constructor(
        private val db: AppDatabase,
        private val writer: LocalWriter,
        private val clock: Clock,
    ) {
        private val purchases = SyncTables.of<PurchaseEntity>("purchases")
        private val items = SyncTables.of<PurchaseItemEntity>("purchase_items")
        private val promotions = SyncTables.of<PromotionEntity>("promotions")
        private val stores = SyncTables.of<StoreEntity>("stores")
        private val branches = SyncTables.of<StoreBranchEntity>("store_branches")

        suspend fun load(id: String): PurchaseDraft? {
            val p = db.purchases().byId(id)?.takeIf { it.deletedAt == null } ?: return null
            val rows = db.purchaseItems().liveOfPurchase(id).sortedBy { it.lineNo }
            val promos = db.promotions().liveOfPurchaseOrItems(id, rows.map { it.id })
            val variants = variants(rows.mapNotNull { it.variantId })
            return PurchaseDraft(
                id = p.id,
                storeId = p.storeId,
                branchId = p.branchId,
                purchasedAt = p.purchasedAt,
                lines =
                    rows.map { row ->
                        val promo = promos.firstOrNull { it.purchaseItemId == row.id }
                        PurchaseLine(
                            id = row.id,
                            variant = row.variantId?.let(variants::get),
                            rawText = row.rawText,
                            quantity = row.quantity,
                            unitPriceCents = row.unitPriceCents,
                            promotion = promo?.let { LinePromotion(it.id, PromoType.fromWire(it.type), PromoParamsJson.decode(it.params), it.discountCents, it.description) },
                        )
                    },
                ticketDiscounts = promos.filter { it.purchaseId == id }.sortedBy { it.createdAt }.map { TicketDiscount(it.id, it.description.orEmpty(), it.discountCents) },
                ticketTotalCents = p.totalCents,
                confirmed = p.status == "confirmed",
                source = p.source,
                notes = p.notes,
            )
        }

        /** Saves [draft] (it needs a store); [confirm] makes it confirmed, otherwise it keeps its status. Returns its id. */
        suspend fun save(
            draft: PurchaseDraft,
            confirm: Boolean = false,
        ): String =
            db.withTransaction {
                val storeId = requireNotNull(draft.storeId) { "Una compra necesita tienda" }
                val now = clock.nowMillis()
                val existing = draft.id?.let { db.purchases().byId(it) }
                val status = if (confirm || draft.confirmed) "confirmed" else "draft"
                val purchase =
                    existing?.copy(
                        storeId = storeId,
                        branchId = draft.branchId,
                        purchasedAt = draft.purchasedAt,
                        discountCents = draft.ticketDiscounts.sumOf { it.amountCents },
                        totalCents = draft.ticketTotalCents,
                        status = status,
                        notes = draft.notes,
                    ) ?: PurchaseEntity(
                        id = Uuids.v7(now),
                        storeId = storeId,
                        branchId = draft.branchId,
                        purchasedAt = draft.purchasedAt,
                        currency = "MXN",
                        discountCents = draft.ticketDiscounts.sumOf { it.amountCents },
                        totalCents = draft.ticketTotalCents,
                        source = draft.source,
                        status = status,
                        notes = draft.notes,
                        createdAt = now,
                        updatedAt = now,
                    )
                writer.write(purchases, listOf(purchase))
                val liveItems = if (existing == null) emptyList() else db.purchaseItems().liveOfPurchase(purchase.id)
                val livePromos = if (existing == null) emptyList() else db.promotions().liveOfPurchaseOrItems(purchase.id, liveItems.map { it.id })
                val byId = liveItems.associateBy { it.id }
                val rows =
                    draft.lines.mapIndexed { i, line ->
                        val a = line.amounts
                        line.id?.let(byId::get)?.copy(
                            lineNo = i + 1L,
                            variantId = line.variant?.id,
                            rawText = line.rawText,
                            quantity = line.quantity,
                            unitPriceCents = line.unitPriceCents,
                            grossCents = a.grossCents,
                            discountCents = a.discountCents,
                            finalCents = a.finalCents,
                        ) ?: PurchaseItemEntity(
                            id = Uuids.v7(now),
                            purchaseId = purchase.id,
                            lineNo = i + 1L,
                            variantId = line.variant?.id,
                            rawText = line.rawText,
                            quantity = line.quantity,
                            unitPriceCents = line.unitPriceCents,
                            grossCents = a.grossCents,
                            discountCents = a.discountCents,
                            finalCents = a.finalCents,
                            createdAt = now,
                            updatedAt = now,
                        )
                    }
                writer.write(items, rows)
                // A removed line takes its promotion with it (LocalWriter's cascade).
                writer.delete(items, liveItems.filter { item -> rows.none { it.id == item.id } })
                val keptPromos = mutableSetOf<String>()
                val promoRows =
                    draft.lines.zip(rows).mapNotNull { (line, row) ->
                        val promo = line.promotion ?: return@mapNotNull null
                        val current = livePromos.firstOrNull { it.purchaseItemId == row.id }
                        promotionRow(current, promo, line.amounts.discountCents, now, purchaseItemId = row.id).also { keptPromos += it.id }
                    } +
                        draft.ticketDiscounts.map { td ->
                            val current = td.id?.let { id -> livePromos.firstOrNull { it.id == id && it.purchaseId == purchase.id } }
                            (
                                current?.copy(description = td.description, discountCents = td.amountCents)
                                    ?: PromotionEntity(
                                        id = Uuids.v7(now),
                                        purchaseId = purchase.id,
                                        type = PromoType.COUPON.wire,
                                        description = td.description,
                                        discountCents = td.amountCents,
                                        affectsPrice = 1,
                                        createdAt = now,
                                        updatedAt = now,
                                    )
                            ).also { keptPromos += it.id }
                        }
                writer.write(promotions, promoRows)
                writer.delete(promotions, livePromos.filter { it.id !in keptPromos && (it.purchaseId == purchase.id || rows.any { r -> r.id == it.purchaseItemId }) })
                purchase.id
            }

        /** RF-COM-08: anyone may; its lines, promotions and receipt images go too (04 §6.2). */
        suspend fun delete(id: String) {
            db.purchases().byId(id)?.let { writer.delete(purchases, listOf(it)) }
        }

        suspend fun variant(id: String): LineVariant? = variants(listOf(id))[id]

        /** The variant of a scanned code here (RF-COM-09), or null. */
        suspend fun variantOfCode(code: String): LineVariant? = db.purchaseEdits().variantOfBarcode(code)?.let { variant(it) }

        /** The variant of [code] once it is here: after a pull, or once someone adds it to the catalog. */
        fun watchCode(code: String): Flow<LineVariant?> = db.scan().hit(code).map { hit -> hit?.let { variant(it.variantId) } }

        suspend fun lastListPrice(
            variantId: String,
            storeId: String,
        ): Long? = db.purchaseEdits().lastListPrice(variantId, storeId)

        /**
         * Variants for a line (S-05): an exact barcode first, then every live variant whose product key or label has all
         * the words, at most [limit]; each with its latest list price at [storeId].
         */
        suspend fun searchVariants(
            query: String,
            storeId: String?,
            limit: Int = 20,
        ): List<VariantChoice> {
            val words = CatalogRepository.searchWords(query)
            val byCode = CatalogRepository.barcodeOf(query)?.let { db.purchaseEdits().variantOfBarcode(it) }
            if (words.isEmpty() && byCode == null) return emptyList()
            val all = db.purchaseEdits().liveVariants()
            val matches = all.filter { row -> words.isNotEmpty() && words.all { w -> "${row.searchKey} ${SearchKey.of(row.label)}".contains(w) } }
            val found = (all.filter { it.id == byCode } + matches).distinctBy { it.id }.take(limit)
            return found.map { row -> VariantChoice(row.toVariant(), storeId?.let { db.purchaseEdits().lastListPrice(row.id, it) }) }
        }

        fun storesByRecentUse(): Flow<List<StoreChoice>> = db.purchaseEdits().storesByRecentUse().map { rows -> rows.map { StoreChoice(it.id, it.name) } }

        fun branchesOf(storeId: String): Flow<List<BranchChoice>> = db.purchaseEdits().branches(storeId).map { rows -> rows.map { BranchChoice(it.id, it.name, it.city) } }

        /** S-14: the city of the last branch used, or Puebla. */
        suspend fun defaultBranchCity(): String = db.purchaseEdits().lastBranchCity() ?: DEFAULT_CITY

        /** "Nueva tienda" (S-14); [kind] is physical, online or both. */
        suspend fun createStore(
            name: String,
            kind: String,
        ): StoreChoice {
            val now = clock.nowMillis()
            val row = StoreEntity(id = Uuids.v7(now), name = name.trim(), kind = kind, defaultCheckIntervalMin = 480, createdAt = now, updatedAt = now)
            writer.write(stores, listOf(row))
            return StoreChoice(row.id, row.name)
        }

        /** "Nueva sucursal" (S-14). */
        suspend fun createBranch(
            storeId: String,
            name: String,
            city: String?,
        ): BranchChoice {
            val now = clock.nowMillis()
            val row = StoreBranchEntity(id = Uuids.v7(now), storeId = storeId, name = name.trim(), city = city?.trim()?.ifEmpty { null }, createdAt = now, updatedAt = now)
            writer.write(branches, listOf(row))
            return BranchChoice(row.id, row.name, row.city)
        }

        private suspend fun variants(ids: List<String>): Map<String, LineVariant> =
            if (ids.isEmpty()) emptyMap() else db.purchaseEdits().variants(ids.distinct()).associate { it.id to it.toVariant() }

        private fun promotionRow(
            current: PromotionEntity?,
            promo: LinePromotion,
            appliedCents: Long,
            now: Long,
            purchaseItemId: String,
        ): PromotionEntity {
            val params = PromoParamsJson.encode(promo.params)
            val affects = if (promo.affectsPrice) 1 else 0
            return current?.copy(type = promo.type.wire, params = params, description = promo.description, discountCents = appliedCents, affectsPrice = affects)
                ?: PromotionEntity(
                    id = Uuids.v7(now),
                    purchaseItemId = purchaseItemId,
                    type = promo.type.wire,
                    params = params,
                    description = promo.description,
                    discountCents = appliedCents,
                    affectsPrice = affects,
                    createdAt = now,
                    updatedAt = now,
                )
        }

        private companion object {
            const val DEFAULT_CITY = "Puebla"
        }
    }

private fun LineVariantRow.toVariant() =
    LineVariant(id, productId, productName, label, brand, Measure.fromWire(measure), unitAmount, packCount.toInt(), soldByWeight == 1, DisplayUnit.fromWire(displayUnit))
