package com.maubautista.maunedas.core.data

import androidx.paging.Pager
import androidx.paging.PagingConfig
import androidx.paging.PagingData
import androidx.paging.map
import com.maubautista.maunedas.core.database.AppDatabase
import com.maubautista.maunedas.core.database.dao.PurchaseSummaryRow
import com.maubautista.maunedas.core.model.HouseholdTime
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import java.time.YearMonth
import javax.inject.Inject
import javax.inject.Singleton

/** A purchase in a list. [storeName] is null only while its store has not arrived by sync. */
data class PurchaseSummary(
    val id: String,
    val storeName: String?,
    val branchName: String?,
    val purchasedAt: Long,
    val totalCents: Long,
    val lineCount: Int,
    val draft: Boolean,
)

/** S-03 filters; `from <= purchased_at <= to`. */
data class PurchaseFilter(
    val storeId: String? = null,
    /** "draft", "confirmed" or null for both. */
    val status: String? = null,
    val from: Long = Long.MIN_VALUE,
    val to: Long = Long.MAX_VALUE,
)

data class StoreOption(
    val id: String,
    val name: String,
)

/** Purchases as the screens read them: Flows from Room only (CLAUDE.md rule 12). */
@Singleton
class PurchaseRepository
    @Inject
    constructor(
        private val db: AppDatabase,
    ) {
        fun recent(limit: Int): Flow<List<PurchaseSummary>> =
            db.purchaseQueries().recent(limit).map { rows -> rows.map { it.toSummary() } }

        /** "Gasto del mes" (05 §5 S-02): confirmed purchases of that month in Mexico City. */
        fun spentIn(month: YearMonth): Flow<Long> = HouseholdTime.span(month).let { db.purchaseQueries().spent(it.from, it.until) }

        fun openDrafts(): Flow<Int> = db.purchaseQueries().openDrafts()

        /** All purchases matching [filter], newest first, paged (05 §3). */
        fun page(filter: PurchaseFilter): Flow<PagingData<PurchaseSummary>> =
            Pager(PagingConfig(pageSize = PAGE_SIZE, enablePlaceholders = false)) {
                db.purchaseQueries().page(filter.storeId, filter.status, filter.from, filter.to)
            }.flow.map { page -> page.map { it.toSummary() } }

        fun storesWithPurchases(): Flow<List<StoreOption>> = db.purchaseQueries().storesWithPurchases().map { rows -> rows.map { StoreOption(it.id, it.name) } }

        fun hasPurchases(): Flow<Boolean> = db.purchaseQueries().hasPurchases()

        private companion object {
            const val PAGE_SIZE = 30
        }
    }

private fun PurchaseSummaryRow.toSummary() = PurchaseSummary(id, storeName, branchName, purchasedAt, totalCents, lineCount, status == "draft")
