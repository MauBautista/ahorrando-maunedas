package com.maubautista.maunedas.core.data

import com.maubautista.maunedas.core.database.AppDatabase
import com.maubautista.maunedas.core.model.Measure
import com.maubautista.maunedas.core.network.ApiException
import com.maubautista.maunedas.core.network.MaunedasApi
import com.maubautista.maunedas.core.sync.SyncScheduler
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map

/** A code of the catalog here (S-12, path 2): the variant and its latest price per store and source. */
data class ScanHit(
    val variantId: String,
    val productId: String,
    val productName: String,
    val variantLabel: String,
    val brand: String?,
    val latest: List<PagePrice>,
)

/** What an open catalog knows of a code (10 §2.1), to prefill "Nuevo producto". */
data class CatalogGuess(
    val name: String?,
    val brand: String?,
    val quantityText: String?,
    val measure: Measure?,
    val unitAmount: Double?,
    val packCount: Int?,
    val imageUrl: String?,
    val attribution: String,
    /** For the imported photo (10 §2.3). */
    val license: String? = null,
    val sourceUrl: String? = null,
)

/** `GET /v1/barcodes/:code` as S-12 reads it. */
sealed interface RemoteLookup {
    /** On the server but not here yet: a pull brings it. */
    data class Match(
        val productName: String,
        val variantLabel: String,
    ) : RemoteLookup

    data class Catalog(
        val guess: CatalogGuess,
    ) : RemoteLookup

    data object NotFound : RemoteLookup

    /** Path 4 without network: "Nuevo producto" with the code. */
    data object NoNetwork : RemoteLookup

    /** The open catalogs failed (502) or something else: also path 4. */
    data object Failed : RemoteLookup
}

data class OpenDraft(
    val id: String,
    val storeName: String?,
)

data class ProductChoice(
    val id: String,
    val name: String,
    val brand: String?,
)

/** The scan result (S-12): Room first, then the API; barcode lookup is one of the direct network calls (05 §3). */
@Singleton
class ScanRepository
    @Inject
    constructor(
        private val db: AppDatabase,
        private val api: MaunedasApi,
        private val scheduler: SyncScheduler,
        private val pages: ProductPageRepository,
    ) {
        /** The variant with this code here, observed (it appears when a pull brings it); null while it is not. */
        @OptIn(ExperimentalCoroutinesApi::class)
        fun local(code: String): Flow<ScanHit?> =
            db.scan().hit(code).flatMapLatest { row ->
                if (row == null) {
                    flowOf(null)
                } else {
                    pages.page(row.productId).map { page ->
                        ScanHit(row.variantId, row.productId, row.productName, row.variantLabel, row.brand, page?.variants?.firstOrNull { it.id == row.variantId }?.latest.orEmpty())
                    }
                }
            }

        suspend fun lookup(code: String): RemoteLookup =
            try {
                val answer = api.barcode(code)
                val match = answer.match
                val catalog = answer.catalog
                when {
                    match != null -> RemoteLookup.Match(match.productName, match.variantLabel)
                    catalog != null ->
                        RemoteLookup.Catalog(
                            CatalogGuess(
                                name = catalog.name,
                                brand = catalog.brand,
                                quantityText = catalog.quantityText,
                                measure = catalog.parsed?.measure?.let { runCatching { Measure.fromWire(it) }.getOrNull() },
                                unitAmount = catalog.parsed?.unitAmount,
                                packCount = catalog.parsed?.packCount,
                                imageUrl = catalog.imageUrl,
                                attribution = catalog.attribution,
                                license = catalog.license,
                                sourceUrl = catalog.sourceUrl,
                            ),
                        )
                    else -> RemoteLookup.NotFound
                }
            } catch (e: IOException) {
                RemoteLookup.NoNetwork
            } catch (e: ApiException) {
                RemoteLookup.Failed
            }

        /** S-12 path 3 "match": the row is on the server; sync now so it comes down. */
        fun pullNow() = scheduler.syncNow()

        fun openDraft(): Flow<OpenDraft?> = db.scan().openDraft().map { it?.let { d -> OpenDraft(d.id, d.storeName) } }

        /** "¿Es otra presentación de un producto que ya tienes?": live products matching every word. */
        suspend fun searchProducts(
            query: String,
            limit: Int = 20,
        ): List<ProductChoice> {
            val words = CatalogRepository.searchWords(query)
            if (words.isEmpty()) return emptyList()
            return db.productPage().otherProducts(exceptId = "").first()
                .filter { row -> words.all { row.searchKey.contains(it) } }
                .take(limit)
                .map { ProductChoice(it.id, it.name, it.detail) }
        }
    }
