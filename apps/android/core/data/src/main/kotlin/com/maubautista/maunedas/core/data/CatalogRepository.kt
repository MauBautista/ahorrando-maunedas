package com.maubautista.maunedas.core.data

import androidx.paging.Pager
import androidx.paging.PagingConfig
import androidx.paging.PagingData
import androidx.paging.map
import com.maubautista.maunedas.core.database.AppDatabase
import com.maubautista.maunedas.core.database.dao.CatalogQuery
import com.maubautista.maunedas.core.database.dao.CatalogSearch
import com.maubautista.maunedas.core.database.entity.CategoryEntity
import com.maubautista.maunedas.core.model.Clock
import com.maubautista.maunedas.core.model.DisplayUnit
import com.maubautista.maunedas.core.model.Measure
import com.maubautista.maunedas.core.model.trimJs
import com.maubautista.maunedas.core.pricing.BestPrices
import com.maubautista.maunedas.core.pricing.SearchKey
import com.maubautista.maunedas.core.pricing.Units
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

/** Lowest price per [unit] among the product's recent points (03 §3); [source] is purchase, shelf or web. */
data class BestPrice(
    val variantLabel: String,
    val displayCents: Long,
    val unit: DisplayUnit,
    val storeName: String?,
    val source: String,
    val observedAt: Long,
)

data class CatalogItem(
    val id: String,
    val name: String,
    val brand: String?,
    val variants: Int,
    val best: BestPrice?,
    /** Its thumbnail for Coil (10 §1), or null without a photo. */
    val photo: Any? = null,
)

/** A category of the tree, in display order; [depth] 0 is a top-level one. */
data class CategoryNode(
    val id: String,
    val name: String,
    val depth: Int,
)

data class TagItem(
    val id: String,
    val name: String,
)

/** The catalog as S-07 reads it, from Room only (CLAUDE.md rule 12). */
@Singleton
class CatalogRepository
    @Inject
    constructor(
        private val db: AppDatabase,
        private val clock: Clock,
        private val photos: ProductPhotos,
    ) {
        /** Products matching the search like `GET /v1/products` (03 §7), each with its best price and thumbnail. */
        fun products(
            query: String,
            categoryId: String?,
            tagId: String?,
        ): Flow<PagingData<CatalogItem>> {
            val search = CatalogSearch(searchWords(query), barcodeOf(query), categoryId, tagId)
            return Pager(PagingConfig(pageSize = PAGE_SIZE, enablePlaceholders = false)) { db.catalogQueries().products(CatalogQuery.products(search)) }
                .flow
                .map { page ->
                    page.map { row ->
                        val unit = DisplayUnit.fromWire(row.displayUnit)
                        CatalogItem(row.id, row.name, row.brand, row.variantCount, best(row.id, unit), photos.thumb(row.primaryImageId))
                    }
                }
        }

        /** The best price of a product over the last 90 days, in its display unit; null without comparable points. */
        suspend fun best(
            productId: String,
            unit: DisplayUnit,
        ): BestPrice? {
            val since = clock.nowMillis() - BestPrices.WINDOW_MS
            val points = db.catalogQueries().pricePoints(productId, since).map { it.toPoint() }
            val best = BestPrices.pick(points, unit) ?: return null
            return BestPrice(best.variantLabel, Units.displayCents(best.centsPerBase, best.measure, unit), unit, best.storeName, best.source, best.observedAt)
        }

        fun hasProducts(): Flow<Boolean> = db.catalogQueries().hasProducts()

        fun categories(): Flow<List<CategoryNode>> = db.catalogQueries().categories().map(::categoryTree)

        fun tags(): Flow<List<TagItem>> = db.catalogQueries().tags().map { tags -> tags.map { TagItem(it.id, it.name) } }

        companion object {
            const val PAGE_SIZE = 30

            /** Words of a search, normalized like `search_key`; at most 8, as `searchWords` in the API. */
            fun searchWords(query: String): List<String> = SearchKey.of(query).split(' ').filter { it.isNotEmpty() }.take(8)

            private val BARCODE = Regex("^[0-9]{6,14}$")

            /** A query of 6 to 14 digits also matches an exact barcode (`isBarcodeQuery`). */
            fun barcodeOf(query: String): String? = query.trimJs().takeIf { BARCODE.matches(it) }
        }
    }

/**
 * Categories in tree order: each parent followed by its children, siblings by `sort_order` and name (as the query
 * returns them). A category whose parent is missing or deleted shows at the top level, and so does one caught in a
 * parent cycle, so none is lost.
 */
internal fun categoryTree(categories: List<CategoryEntity>): List<CategoryNode> {
    val ids = categories.mapTo(HashSet()) { it.id }
    val children = categories.groupBy { it.parentId?.takeIf { parent -> parent in ids } }
    val out = mutableListOf<CategoryNode>()
    val seen = HashSet<String>()

    fun visit(
        parent: String?,
        depth: Int,
    ) {
        for (c in children[parent].orEmpty()) {
            if (!seen.add(c.id)) continue
            out += CategoryNode(c.id, c.name, depth)
            visit(c.id, depth + 1)
        }
    }
    visit(null, 0)
    for (c in categories) {
        if (seen.add(c.id)) {
            out += CategoryNode(c.id, c.name, 0)
            visit(c.id, 1)
        }
    }
    return out
}
