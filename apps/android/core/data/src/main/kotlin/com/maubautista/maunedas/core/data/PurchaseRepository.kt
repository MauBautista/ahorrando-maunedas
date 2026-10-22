package com.maubautista.maunedas.core.data

import com.maubautista.maunedas.core.database.AppDatabase
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

/** Purchases as the screens read them: Flows from Room only (CLAUDE.md rule 12). */
@Singleton
class PurchaseRepository
    @Inject
    constructor(
        private val db: AppDatabase,
    ) {
        fun recent(limit: Int): Flow<List<PurchaseSummary>> =
            db.purchaseQueries().recent(limit).map { rows ->
                rows.map { PurchaseSummary(it.id, it.storeName, it.branchName, it.purchasedAt, it.totalCents, it.lineCount, it.status == "draft") }
            }

        /** "Gasto del mes" (05 §5 S-02): confirmed purchases of that month in Mexico City. */
        fun spentIn(month: YearMonth): Flow<Long> = HouseholdTime.span(month).let { db.purchaseQueries().spent(it.from, it.until) }

        fun openDrafts(): Flow<Int> = db.purchaseQueries().openDrafts()
    }
