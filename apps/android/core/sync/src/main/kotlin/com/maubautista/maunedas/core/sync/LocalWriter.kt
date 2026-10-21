package com.maubautista.maunedas.core.sync

import androidx.room.withTransaction
import com.maubautista.maunedas.core.database.AppDatabase
import com.maubautista.maunedas.core.database.entity.OutboxEntry
import com.maubautista.maunedas.core.database.entity.PromotionEntity
import com.maubautista.maunedas.core.database.entity.PurchaseItemEntity
import com.maubautista.maunedas.core.database.entity.VariantEntity
import com.maubautista.maunedas.core.model.Clock
import com.maubautista.maunedas.core.model.CurrentUser
import javax.inject.Inject

/**
 * Every domain write goes through here (04 §6.2): stamps `updated_at`/`updated_by`, upserts and enqueues the
 * rows in the same transaction, then asks for a sync. The UI never writes Room directly.
 */
class LocalWriter
    @Inject
    constructor(
        private val db: AppDatabase,
        private val clock: Clock,
        private val user: CurrentUser,
        private val scheduler: SyncRequester,
    ) {
        suspend fun <T : Any> write(
            table: SyncTable<T>,
            rows: List<T>,
        ) {
            require(table.mode == SyncMode.SYNC) { "${table.name} no se escribe desde el cliente" }
            if (rows.isEmpty()) return
            db.withTransaction { writeInTransaction(table, rows, clock.nowMillis()) }
            scheduler.requestSoon()
        }

        /** Tombstones (never physical deletes), with the cascades of 04 §6.2. */
        suspend fun <T : Any> delete(
            table: SyncTable<T>,
            rows: List<T>,
        ) {
            require(table.mode == SyncMode.SYNC) { "${table.name} no se escribe desde el cliente" }
            if (rows.isEmpty()) return
            db.withTransaction {
                val now = clock.nowMillis()
                val tombstone = table.tombstone!!
                writeInTransaction(table, rows.map { tombstone(it, now) }, now)
                cascade(table.name, rows.map(table.id), now)
            }
            scheduler.requestSoon()
        }

        private suspend fun <T : Any> writeInTransaction(
            table: SyncTable<T>,
            rows: List<T>,
            now: Long,
        ) {
            val stamp = table.stamp!!
            val stamped = rows.map { stamp(it, now, user.id()) }
            table.dao(db).upsertAll(stamped)
            db.outbox().enqueueAll(stamped.map { OutboxEntry(tableName = table.name, rowId = table.id(it), enqueuedAt = now) })
        }

        private suspend fun <T : Any> tombstoneAll(
            name: String,
            rows: List<T>,
            now: Long,
        ) {
            if (rows.isEmpty()) return
            val table = SyncTables.of<T>(name)
            writeInTransaction(table, rows.map { table.tombstone!!(it, now) }, now)
        }

        /**
         * Purchase → its lines, promotions and receipt images; line → its promotions; product → variants and
         * theirs; variant → barcodes, listings and alert rules. Purchase lines and observations of a deleted
         * variant stay (history).
         */
        private suspend fun cascade(
            table: String,
            ids: List<String>,
            now: Long,
        ) {
            when (table) {
                "purchases" ->
                    for (id in ids) {
                        val items = db.purchaseItems().liveOfPurchase(id)
                        tombstoneAll<PurchaseItemEntity>("purchase_items", items, now)
                        tombstoneAll<PromotionEntity>("promotions", db.promotions().liveOfPurchaseOrItems(id, items.map { it.id }), now)
                        tombstoneAll("images", db.images().liveOf("purchase", id, "receipt"), now)
                    }
                "purchase_items" -> tombstoneAll("promotions", db.promotions().liveOfPurchaseOrItems(null, ids), now)
                "products" -> {
                    val variants = db.variants().liveOfProducts(ids)
                    tombstoneAll<VariantEntity>("variants", variants, now)
                    cascade("variants", variants.map { it.id }, now)
                }
                "variants" -> {
                    tombstoneAll("barcodes", db.barcodes().liveOfVariants(ids), now)
                    tombstoneAll("listings", db.listings().liveOfVariants(ids), now)
                    tombstoneAll("alert_rules", db.alertRules().liveOfVariants(ids), now)
                }
            }
        }
    }

/** What a write needs from scheduling: run a sync soon (04 §6.6). */
fun interface SyncRequester {
    fun requestSoon()
}
