package com.maubautista.maunedas.core.data

import com.maubautista.maunedas.core.database.AppDatabase
import com.maubautista.maunedas.core.database.dao.CatalogPointRow
import com.maubautista.maunedas.core.database.entity.CategoryEntity
import com.maubautista.maunedas.core.database.entity.ProductEntity
import com.maubautista.maunedas.core.database.entity.VariantEntity
import com.maubautista.maunedas.core.model.Clock
import com.maubautista.maunedas.core.model.DisplayUnit
import com.maubautista.maunedas.core.model.Measure
import com.maubautista.maunedas.core.pricing.BestPrices
import com.maubautista.maunedas.core.pricing.Content
import com.maubautista.maunedas.core.pricing.ParsedQuantity
import com.maubautista.maunedas.core.pricing.PriceComparison
import com.maubautista.maunedas.core.pricing.PricePoint
import com.maubautista.maunedas.core.pricing.QuantityParser
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import javax.inject.Inject
import javax.inject.Singleton

/** A price as the product page shows it; [source] is purchase, shelf or web. */
data class PagePrice(
    val storeId: String,
    val storeName: String?,
    val source: String,
    /** What one unit of the variant cost (after promotions); null for an observation without one. */
    val effectiveUnitCents: Long?,
    val displayCents: Long,
    val unit: DisplayUnit,
    val observedAt: Long,
)

data class PageVariant(
    val id: String,
    val label: String,
    /** The content as the assistant would name it ("6 × 1 L"), or "A granel (kg)". */
    val content: String,
    val measure: Measure,
    val codes: List<String>,
    /** Newest price per store and source, newest first. */
    val latest: List<PagePrice>,
)

/** A row of "Comparar" (RF-PRE-04), in [unit]; [best] marks the cheapest comparable one. */
data class PageComparison(
    val variantId: String,
    val variantLabel: String,
    val storeId: String,
    val storeName: String?,
    val unit: DisplayUnit,
    val last: PagePrice,
    val minCents: Long,
    val minAt: Long,
    val avgCents: Long,
    val n: Int,
    val best: Boolean,
    /** False for a variant whose measure does not fit the product's unit: it never competes (03 §3). */
    val comparable: Boolean,
)

data class ProductPage(
    val id: String,
    val name: String,
    val brand: String?,
    /** "Refrigerados › Lácteos". */
    val categoryPath: String?,
    val tags: List<String>,
    val displayUnit: DisplayUnit,
    val variants: List<PageVariant>,
    val comparison: List<PageComparison>,
)

/** S-08 from Room: what `GET /v1/products/:id` and `/compare` (03 §7) give the web, with the same rules. */
@Singleton
class ProductPageRepository
    @Inject
    constructor(
        private val db: AppDatabase,
        private val clock: Clock,
    ) {
        /** Null when the product does not exist or was deleted (or merged into another). */
        fun page(productId: String): Flow<ProductPage?> {
            val page = db.productPage()
            val parts =
                combine(
                    page.product(productId),
                    page.tags(productId),
                    db.catalogEdits().liveVariantsOf(productId),
                    page.barcodes(productId),
                    db.catalogQueries().categories(),
                ) { product, tags, variants, codes, categories -> Parts(product, tags.map { it.name }, variants, codes.groupBy({ it.variantId }, { it.code }), categories) }
            return combine(parts, db.catalogQueries().allPricePoints(productId)) { p, points -> p.product?.let { build(p, points) } }
        }

        private fun build(
            p: Parts,
            rows: List<CatalogPointRow>,
        ): ProductPage {
            val product = p.product!!
            val unit = DisplayUnit.fromWire(product.displayUnit)
            val points = rows.map { it.toPoint() }
            val latest = PriceComparison.latest(points, unit).groupBy { it.point.variantId }
            val since = clock.nowMillis() - BestPrices.WINDOW_MS
            val comparison = PriceComparison.compare(points.filter { it.observedAt >= since }, unit)
            val labels = p.variants.associate { it.id to it.label }
            return ProductPage(
                id = product.id,
                name = product.name,
                brand = product.brand,
                categoryPath = categoryPath(product.categoryId, p.categories),
                tags = p.tags,
                displayUnit = unit,
                variants =
                    p.variants.map { v ->
                        val measure = Measure.fromWire(v.measure)
                        PageVariant(
                            id = v.id,
                            label = v.label,
                            content = if (v.soldByWeight == 1) Content.BULK_LABEL else QuantityParser.suggestVariantLabel(ParsedQuantity(measure, v.unitAmount, v.packCount.toInt())),
                            measure = measure,
                            codes = p.codes[v.id].orEmpty(),
                            latest = latest[v.id].orEmpty().map { it.point.toPagePrice(it.displayCents, it.unit) },
                        )
                    },
                comparison =
                    comparison.rows.map { r ->
                        PageComparison(
                            variantId = r.last.variantId,
                            variantLabel = labels[r.last.variantId] ?: r.last.variantLabel,
                            storeId = r.last.storeId,
                            storeName = r.last.storeName,
                            unit = r.unit,
                            last = r.last.toPagePrice(r.lastCents, r.unit),
                            minCents = r.minCents,
                            minAt = r.min.observedAt,
                            avgCents = r.avgCents,
                            n = r.n,
                            best = comparison.best == r.last.variantId to r.last.storeId,
                            comparable = r.last.measure == unit.measure,
                        )
                    },
            )
        }

        private class Parts(
            val product: ProductEntity?,
            val tags: List<String>,
            val variants: List<VariantEntity>,
            val codes: Map<String, List<String>>,
            val categories: List<CategoryEntity>,
        )
    }

internal fun CatalogPointRow.toPoint() =
    PricePoint(pointId, source, variantId, variantLabel, Measure.fromWire(measure), storeId, storeName, observedAt, centsPerBase, effectiveUnitCents)

private fun PricePoint.toPagePrice(
    displayCents: Long,
    unit: DisplayUnit,
) = PagePrice(storeId, storeName, source, effectiveUnitCents, displayCents, unit, observedAt)

/** Names from the root down to the category; a missing parent ends the path. */
private fun categoryPath(
    id: String?,
    categories: List<CategoryEntity>,
): String? {
    val byId = categories.associateBy { it.id }
    val names = mutableListOf<String>()
    var current = id?.let(byId::get)
    while (current != null && names.size < categories.size) {
        names += current.name
        current = current.parentId?.let(byId::get)
    }
    return names.takeIf { it.isNotEmpty() }?.reversed()?.joinToString(" › ")
}
