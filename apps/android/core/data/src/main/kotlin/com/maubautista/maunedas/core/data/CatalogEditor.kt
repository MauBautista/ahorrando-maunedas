package com.maubautista.maunedas.core.data

import androidx.room.withTransaction
import com.maubautista.maunedas.core.database.AppDatabase
import com.maubautista.maunedas.core.database.entity.BarcodeEntity
import com.maubautista.maunedas.core.database.entity.ProductEntity
import com.maubautista.maunedas.core.database.entity.ProductTagEntity
import com.maubautista.maunedas.core.database.entity.TagEntity
import com.maubautista.maunedas.core.database.entity.VariantEntity
import com.maubautista.maunedas.core.model.Clock
import com.maubautista.maunedas.core.model.DisplayUnit
import com.maubautista.maunedas.core.model.Measure
import com.maubautista.maunedas.core.model.Uuids
import com.maubautista.maunedas.core.pricing.SearchKey
import com.maubautista.maunedas.core.sync.LocalWriter
import com.maubautista.maunedas.core.sync.SyncTables
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

/** What S-09 edits. [newTags] are names typed with "alta rápida"; they become tags when the product is saved. */
data class ProductDraft(
    val id: String? = null,
    val name: String = "",
    val brand: String = "",
    val categoryId: String? = null,
    val tagIds: Set<String> = emptySet(),
    val newTags: List<String> = emptyList(),
    val displayUnit: DisplayUnit = DisplayUnit.PZ,
    val notes: String = "",
)

/** What S-10 edits, already in base units; [codes] are the variant's live barcodes. */
data class VariantDraft(
    val id: String? = null,
    val label: String,
    val measure: Measure,
    val unitAmount: Double,
    val packCount: Int,
    val soldByWeight: Boolean,
    val codes: List<String>,
)

data class VariantSummary(
    val id: String,
    val label: String,
)

/** A barcode is already live on another variant (the `uq_barcodes_code_live` index, RF-CAT-03). */
data class BarcodeOwner(
    val variantId: String,
    val productName: String,
    val variantLabel: String,
)

class BarcodeTakenException(
    val code: String,
    val owner: BarcodeOwner,
) : IllegalStateException("El código $code ya es de ${owner.productName} · ${owner.variantLabel}")

/**
 * Creates and edits products, variants, tags and barcodes through [LocalWriter] (04 §6.2), each save in one
 * transaction. Deletes are for admins: the screens hide them and the server rejects others (RF-CAT-08).
 */
@Singleton
class CatalogEditor
    @Inject
    constructor(
        private val db: AppDatabase,
        private val writer: LocalWriter,
        private val clock: Clock,
    ) {
        private val products = SyncTables.of<ProductEntity>("products")
        private val variants = SyncTables.of<VariantEntity>("variants")
        private val barcodes = SyncTables.of<BarcodeEntity>("barcodes")
        private val tags = SyncTables.of<TagEntity>("tags")
        private val productTags = SyncTables.of<ProductTagEntity>("product_tags")

        suspend fun loadProduct(id: String): ProductDraft? {
            val p = db.products().byId(id)?.takeIf { it.deletedAt == null } ?: return null
            return ProductDraft(
                id = p.id,
                name = p.name,
                brand = p.brand.orEmpty(),
                categoryId = p.categoryId,
                tagIds = db.catalogEdits().liveTagIds(id).toSet(),
                displayUnit = DisplayUnit.fromWire(p.displayUnit),
                notes = p.notes.orEmpty(),
            )
        }

        fun variantsOf(productId: String): Flow<List<VariantSummary>> =
            db.catalogEdits().liveVariantsOf(productId).map { rows -> rows.map { VariantSummary(it.id, it.label) } }

        suspend fun loadVariant(id: String): VariantDraft? {
            val v = db.variants().byId(id)?.takeIf { it.deletedAt == null } ?: return null
            return VariantDraft(
                id = v.id,
                label = v.label,
                measure = Measure.fromWire(v.measure),
                unitAmount = v.unitAmount,
                packCount = v.packCount.toInt(),
                soldByWeight = v.soldByWeight == 1,
                codes = db.barcodes().liveOfVariants(listOf(id)).sortedBy { it.createdAt }.map { it.code },
            )
        }

        /** The variant that already has [code], unless it is [exceptVariant] (the one being edited). */
        suspend fun barcodeOwner(
            code: String,
            exceptVariant: String? = null,
        ): BarcodeOwner? =
            db.catalogEdits().barcodeOwner(code)?.takeIf { it.variantId != exceptVariant }?.let {
                BarcodeOwner(it.variantId, it.productName, it.variantLabel)
            }

        /** Saves the product, its tags and, for a new product, its first variant; returns the product id. */
        suspend fun saveProduct(
            draft: ProductDraft,
            firstVariant: VariantDraft? = null,
        ): String =
            db.withTransaction {
                val now = clock.nowMillis()
                val name = draft.name.trim()
                val brand = draft.brand.trim().ifEmpty { null }
                val row =
                    draft.id?.let { db.products().byId(it) }?.copy(
                        name = name,
                        brand = brand,
                        categoryId = draft.categoryId,
                        displayUnit = draft.displayUnit.wire,
                        notes = draft.notes.trim().ifEmpty { null },
                    ) ?: ProductEntity(
                        id = Uuids.v7(now),
                        name = name,
                        brand = brand,
                        categoryId = draft.categoryId,
                        displayUnit = draft.displayUnit.wire,
                        notes = draft.notes.trim().ifEmpty { null },
                        searchKey = "",
                        createdAt = now,
                        updatedAt = now,
                    )
                // The server derives it too; computing it here makes the product findable offline (03 §7).
                writer.write(products, listOf(row.copy(searchKey = SearchKey.of("$name ${brand.orEmpty()}"))))
                saveTags(row.id, draft.tagIds + tagIdsFor(draft.newTags, now), now)
                firstVariant?.let { saveVariantInTransaction(row.id, it, now) }
                row.id
            }

        suspend fun saveVariant(
            productId: String,
            draft: VariantDraft,
        ): String = db.withTransaction { saveVariantInTransaction(productId, draft, clock.nowMillis()) }

        /** Admin only (RF-CAT-08): also its variants and their barcodes; purchases and prices stay (04 §6.2). */
        suspend fun deleteProduct(id: String) {
            db.products().byId(id)?.let { writer.delete(products, listOf(it)) }
        }

        /** Admin only (RF-CAT-08): also its barcodes, listings and alert rules. */
        suspend fun deleteVariant(id: String) {
            db.variants().byId(id)?.let { writer.delete(variants, listOf(it)) }
        }

        /** Existing live tags by name (ignoring case, as `tags.name COLLATE NOCASE`), new ones otherwise. */
        private suspend fun tagIdsFor(
            names: List<String>,
            now: Long,
        ): Set<String> {
            val live = db.catalogEdits().liveTags().associateBy { it.name.trim().lowercase() }
            val created = mutableMapOf<String, TagEntity>()
            val ids =
                names.map { it.trim() }.filter { it.isNotEmpty() }.map { name ->
                    val key = name.lowercase()
                    (live[key] ?: created.getOrPut(key) { TagEntity(id = Uuids.v7(now), name = name, createdAt = now, updatedAt = now) }).id
                }
            writer.write(tags, created.values.toList())
            return ids.toSet()
        }

        /** product_tags ids are UUIDv5(product:tag): taking a tag back revives its row instead of adding one. */
        private suspend fun saveTags(
            productId: String,
            wanted: Set<String>,
            now: Long,
        ) {
            val current = db.catalogEdits().liveTagIds(productId).toSet()
            val added =
                (wanted - current).map { tagId ->
                    val id = Uuids.productTagId(productId, tagId)
                    db.productTags().byId(id)?.copy(deletedAt = null)
                        ?: ProductTagEntity(id = id, productId = productId, tagId = tagId, createdAt = now, updatedAt = now)
                }
            writer.write(productTags, added)
            writer.delete(productTags, (current - wanted).mapNotNull { db.productTags().byId(Uuids.productTagId(productId, it)) })
        }

        private suspend fun saveVariantInTransaction(
            productId: String,
            draft: VariantDraft,
            now: Long,
        ): String {
            val existing = draft.id?.let { db.variants().byId(it) }
            val row =
                existing?.copy(
                    label = draft.label.trim(),
                    measure = draft.measure.wire,
                    unitAmount = draft.unitAmount,
                    packCount = draft.packCount.toLong(),
                    soldByWeight = if (draft.soldByWeight) 1 else 0,
                ) ?: VariantEntity(
                    id = Uuids.v7(now),
                    productId = productId,
                    label = draft.label.trim(),
                    measure = draft.measure.wire,
                    unitAmount = draft.unitAmount,
                    packCount = draft.packCount.toLong(),
                    soldByWeight = if (draft.soldByWeight) 1 else 0,
                    createdAt = now,
                    updatedAt = now,
                )
            val live = if (existing == null) emptyList() else db.barcodes().liveOfVariants(listOf(row.id))
            val wanted = draft.codes.distinct()
            val added = wanted - live.map { it.code }.toSet()
            for (code in added) barcodeOwner(code, exceptVariant = row.id)?.let { throw BarcodeTakenException(code, it) }
            writer.write(variants, listOf(row))
            writer.write(
                barcodes,
                added.map { BarcodeEntity(id = Uuids.v7(now), variantId = row.id, code = it, source = "manual", createdAt = now, updatedAt = now) },
            )
            writer.delete(barcodes, live.filter { it.code !in wanted })
            return row.id
        }
    }
