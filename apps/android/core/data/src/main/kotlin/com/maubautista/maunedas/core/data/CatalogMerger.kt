package com.maubautista.maunedas.core.data

import com.maubautista.maunedas.core.database.AppDatabase
import com.maubautista.maunedas.core.database.dao.MergeCandidateRow
import com.maubautista.maunedas.core.model.Measure
import com.maubautista.maunedas.core.network.ApiException
import com.maubautista.maunedas.core.network.MaunedasApi
import com.maubautista.maunedas.core.network.dto.MergeRequest
import com.maubautista.maunedas.core.pricing.SearchKey
import com.maubautista.maunedas.core.sync.SyncRequester
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.serialization.json.jsonPrimitive
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

/** What the server answered to a merge (03 §11). */
sealed interface MergeResult {
    data object Done : MergeResult

    /** Local changes still to push: the server would merge without them (RF-CAT-07 needs every row there). */
    data object PendingChanges : MergeResult

    data object NoNetwork : MergeResult

    /** `MERGE_INVALID`: [reason] is SAME, DELETED or MEASURE_MISMATCH. */
    data class Invalid(
        val reason: String?,
    ) : MergeResult

    data object Forbidden : MergeResult

    data class Failed(
        val error: Throwable,
    ) : MergeResult
}

/** Someone to merge into: a product (with its brand) or a variant (with its product's name). */
data class MergeCandidate(
    val id: String,
    val name: String,
    val detail: String?,
)

/**
 * The admin merge (RF-CAT-03, RF-CAT-07) through `POST /v1/admin/merge`: one of the few calls a screen makes
 * directly, since only the server can move every reference (05 §3, decision T57). The merged rows come back by
 * pull, so a sync is asked right after.
 */
@Singleton
class CatalogMerger
    @Inject
    constructor(
        private val api: MaunedasApi,
        private val db: AppDatabase,
        private val sync: SyncRequester,
    ) {
        suspend fun mergeProducts(
            sourceId: String,
            targetId: String,
        ): MergeResult = merge("product", sourceId, targetId)

        suspend fun mergeVariants(
            sourceId: String,
            targetId: String,
        ): MergeResult = merge("variant", sourceId, targetId)

        /** Other live products matching [query] (every word, like the catalog search). */
        fun productCandidates(
            exceptId: String,
            query: Flow<String>,
        ): Flow<List<MergeCandidate>> = filtered(db.productPage().otherProducts(exceptId), query)

        /** Other live variants of the same [measure]; the server refuses mixing measures. */
        fun variantCandidates(
            exceptId: String,
            measure: Measure,
            query: Flow<String>,
        ): Flow<List<MergeCandidate>> = filtered(db.productPage().otherVariants(exceptId, measure.wire), query)

        private fun filtered(
            rows: Flow<List<MergeCandidateRow>>,
            query: Flow<String>,
        ): Flow<List<MergeCandidate>> =
            combine(rows, query) { all, q ->
                val words = CatalogRepository.searchWords(q)
                all.filter { row -> words.all { w -> row.searchKey.contains(w) || SearchKey.of(row.detail.orEmpty()).contains(w) } }
                    .map { MergeCandidate(it.id, it.name, it.detail) }
            }

        private suspend fun merge(
            kind: String,
            sourceId: String,
            targetId: String,
        ): MergeResult {
            if (db.outbox().count() > 0) {
                sync.requestSoon()
                return MergeResult.PendingChanges
            }
            return try {
                api.merge(MergeRequest(kind, sourceId, targetId))
                sync.requestSoon()
                MergeResult.Done
            } catch (e: IOException) {
                MergeResult.NoNetwork
            } catch (e: ApiException) {
                when (e.code) {
                    "MERGE_INVALID" -> MergeResult.Invalid(e.details?.get("reason")?.jsonPrimitive?.content)
                    "FORBIDDEN" -> MergeResult.Forbidden
                    else -> MergeResult.Failed(e)
                }
            }
        }
    }
