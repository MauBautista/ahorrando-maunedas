package com.maubautista.maunedas.core.data

import android.content.Context
import androidx.room.withTransaction
import com.maubautista.maunedas.core.database.AppDatabase
import com.maubautista.maunedas.core.database.entity.AlertRuleEntity
import com.maubautista.maunedas.core.database.entity.BarcodeEntity
import com.maubautista.maunedas.core.database.entity.ImageEntity
import com.maubautista.maunedas.core.database.entity.ListingEntity
import com.maubautista.maunedas.core.database.entity.PriceObservationEntity
import com.maubautista.maunedas.core.database.entity.PurchaseItemEntity
import com.maubautista.maunedas.core.database.entity.ReceiptAliasEntity
import com.maubautista.maunedas.core.database.entity.SyncIssueEntity
import com.maubautista.maunedas.core.model.Clock
import com.maubautista.maunedas.core.model.CurrentUser
import com.maubautista.maunedas.core.sync.LocalWriter
import com.maubautista.maunedas.core.sync.SyncTables
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton

data class PendingTable(
    val table: String,
    val count: Int,
)

/** A change the server refused (04 §6.5) and how S-16 names it; [label] is the row's name when it can be found. */
data class RejectedChange(
    val id: Long,
    val table: String,
    val rowId: String,
    val reason: String,
    /** `details.reason`: MISSING_PARENT, MEASURE_LOCKED, DUPLICATE_IN_BATCH, ADMIN_DELETE… */
    val detailReason: String?,
    val createdAt: Long,
    val label: String?,
)

/** S-17: my barcode is already another variant's on the server. Names are null while those rows are not here yet. */
data class BarcodeConflict(
    val issueId: Long,
    val barcodeId: String,
    val code: String,
    val myVariantId: String,
    val myVariantName: String?,
    val theirVariantId: String,
    val theirVariantName: String?,
)

/** Settings and sync screens (S-15 to S-17): what is pending, what was refused, the barcode dialog and local photos. */
@Singleton
class SyncCenter
    @Inject
    constructor(
        @ApplicationContext private val context: Context,
        private val db: AppDatabase,
        private val writer: LocalWriter,
        private val user: CurrentUser,
        private val clock: Clock,
    ) {
        private val json = Json { ignoreUnknownKeys = true }

        fun pendingByTable(): Flow<List<PendingTable>> = db.outbox().observePerTable().map { rows -> rows.map { PendingTable(it.tableName, it.count) } }

        fun pendingUploads(): Flow<Int> = db.pendingUploads().observeCount()

        /** Unresolved refusals except barcode conflicts, which have their own dialog. */
        fun rejected(): Flow<List<RejectedChange>> =
            db.syncIssues().observeUnresolved().map { issues ->
                issues.filter { it.reason != BARCODE_TAKEN }.map { RejectedChange(it.id, it.tableName, it.rowId, it.reason, detailReason(it.detailsJson), it.createdAt, label(it.tableName, it.rowId)) }
            }

        /** "Entendido": the refusal leaves the list (the row stays as the server left it). */
        suspend fun dismiss(issueId: Long) = db.syncIssues().resolve(issueId, clock.nowMillis())

        fun barcodeConflicts(): Flow<List<BarcodeConflict>> =
            db.syncIssues().observeUnresolved().map { issues ->
                issues.filter { it.reason == BARCODE_TAKEN }.mapNotNull { conflict(it) }
            }

        /**
         * "Usar esa variante" (04 §6.5): my lines, shelf prices, listings, own alert rules, receipt aliases and photos move
         * to the variant that already has the code, and my barcode is deleted.
         */
        suspend fun useTheirVariant(c: BarcodeConflict) {
            val refs = db.variantRefs()
            val from = c.myVariantId
            val to = c.theirVariantId
            db.withTransaction {
                writer.write(SyncTables.of<PurchaseItemEntity>("purchase_items"), refs.purchaseItems(from).map { it.copy(variantId = to) })
                writer.write(SyncTables.of<PriceObservationEntity>("price_observations"), refs.shelfObservations(from).map { it.copy(variantId = to) })
                writer.write(SyncTables.of<ListingEntity>("listings"), db.listings().liveOfVariants(listOf(from)).map { it.copy(variantId = to) })
                user.id()?.let { me -> writer.write(SyncTables.of<AlertRuleEntity>("alert_rules"), refs.ownAlertRules(from, me).map { it.copy(variantId = to) }) }
                writer.write(SyncTables.of<ReceiptAliasEntity>("receipt_aliases"), refs.receiptAliases(from).map { it.copy(variantId = to) })
                writer.write(SyncTables.of<ImageEntity>("images"), refs.images(from).map { it.copy(ownerId = to) })
                keepSeparateInTransaction(c)
            }
        }

        /** "Mantener separado": only my barcode goes away. */
        suspend fun keepSeparate(c: BarcodeConflict) = db.withTransaction { keepSeparateInTransaction(c) }

        private suspend fun keepSeparateInTransaction(c: BarcodeConflict) {
            db.barcodes().byId(c.barcodeId)?.let { writer.delete(SyncTables.of<BarcodeEntity>("barcodes"), listOf(it)) }
            db.syncIssues().resolve(c.issueId, clock.nowMillis())
        }

        /** Bytes of photos kept on the phone (S-15 "Almacenamiento"). */
        suspend fun localPhotosBytes(): Long = withContext(Dispatchers.IO) { photosDir().walkBottomUp().filter { it.isFile }.sumOf { it.length() } }

        /**
         * "Liberar espacio" (10 §4): deletes local photos that are already uploaded; the ones still waiting stay.
         * Returns the bytes freed. Photos are shown from the server afterwards.
         */
        suspend fun freeSpace(): Long {
            val waiting = db.pendingUploads().next(Int.MAX_VALUE).mapNotNull { it.localPath?.let { path -> File(path).canonicalPath } }.toSet()
            return withContext(Dispatchers.IO) {
                var freed = 0L
                photosDir().walkBottomUp().forEach { f ->
                    if (f.isFile && f.canonicalPath !in waiting) {
                        val size = f.length()
                        if (f.delete()) freed += size
                    } else if (f.isDirectory && f != photosDir()) {
                        f.delete() // only when empty
                    }
                }
                freed
            }
        }

        private fun photosDir() = File(context.filesDir, "images")

        private suspend fun conflict(issue: SyncIssueEntity): BarcodeConflict? {
            val barcode = db.barcodes().byId(issue.rowId) ?: return null
            val theirs = details(issue.detailsJson)?.get("variant_id")?.jsonPrimitive?.contentOrNull ?: return null
            return BarcodeConflict(issue.id, barcode.id, barcode.code, barcode.variantId, variantName(barcode.variantId), theirs, variantName(theirs))
        }

        private suspend fun variantName(id: String): String? {
            val v = db.variants().byId(id) ?: return null
            val product = db.products().byId(v.productId)?.name
            return listOfNotNull(product, v.label).joinToString(" · ")
        }

        /** The row's name in the tables people know by name ("Otro dispositivo actualizó …", S-16). */
        suspend fun rowName(
            table: String,
            rowId: String,
        ): String? = label(table, rowId)

        private suspend fun label(
            table: String,
            rowId: String,
        ): String? =
            when (table) {
                "products" -> db.products().byId(rowId)?.name
                "variants" -> variantName(rowId)
                "barcodes" -> db.barcodes().byId(rowId)?.code
                "stores" -> db.stores().byId(rowId)?.name
                "store_branches" -> db.storeBranches().byId(rowId)?.name
                "tags" -> db.tags().byId(rowId)?.name
                "purchases" -> db.purchases().byId(rowId)?.let { db.stores().byId(it.storeId)?.name }
                "purchase_items" -> db.purchaseItems().byId(rowId)?.variantId?.let { variantName(it) }
                "price_observations" -> db.priceObservations().byId(rowId)?.variantId?.let { variantName(it) }
                else -> null
            }

        /** The conflict handler wraps the details as `{details, server_row}`; push and upload refusals store them bare. */
        private fun details(raw: String?): JsonObject? {
            val o = raw?.let { runCatching { json.parseToJsonElement(it).jsonObject }.getOrNull() } ?: return null
            return (o["details"] as? JsonObject) ?: o
        }

        private fun detailReason(raw: String?): String? = details(raw)?.get("reason")?.jsonPrimitive?.contentOrNull

        private companion object {
            const val BARCODE_TAKEN = "BARCODE_TAKEN"
        }
    }
