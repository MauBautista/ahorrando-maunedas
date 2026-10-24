package com.maubautista.maunedas.feature.catalog

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.maubautista.maunedas.core.data.PageComparison
import com.maubautista.maunedas.core.data.PagePrice
import com.maubautista.maunedas.core.data.PageVariant
import com.maubautista.maunedas.core.data.ProductPage
import com.maubautista.maunedas.core.designsystem.Spacing
import com.maubautista.maunedas.core.designsystem.component.PriceSource
import com.maubautista.maunedas.core.designsystem.component.PriceText
import com.maubautista.maunedas.core.designsystem.component.UnitPriceText
import com.maubautista.maunedas.core.designsystem.component.label
import com.maubautista.maunedas.core.model.Money
import com.maubautista.maunedas.core.ui.Dates
import com.maubautista.maunedas.core.ui.ProductPhoto
import com.maubautista.maunedas.core.designsystem.R as DesignR

/** Where the product page leads. */
data class ProductPageActions(
    val onBack: () -> Unit = {},
    val onEdit: () -> Unit = {},
    val onAddVariant: () -> Unit = {},
    val onOpenVariant: (String) -> Unit = {},
    val onMergeProduct: () -> Unit = {},
    val onMergeVariant: (PageVariant) -> Unit = {},
    val onDelete: () -> Unit = {},
)

@Composable
fun ProductPageRoute(
    onBack: () -> Unit,
    onEdit: (productId: String) -> Unit,
    onOpenVariant: (productId: String, variantId: String?) -> Unit,
    onMoved: (productId: String) -> Unit,
    viewModel: ProductPageViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val isAdmin by viewModel.isAdmin.collectAsStateWithLifecycle()
    val merge by viewModel.merge.collectAsStateWithLifecycle()
    val candidates by viewModel.candidates.collectAsStateWithLifecycle()
    val message by viewModel.message.collectAsStateWithLifecycle()
    val confirmDelete by viewModel.confirmDelete.collectAsStateWithLifecycle()
    val historyVariantId by viewModel.historyVariantId.collectAsStateWithLifecycle()
    val historyFilter by viewModel.historyFilter.collectAsStateWithLifecycle()
    val history by viewModel.history.collectAsStateWithLifecycle()
    LaunchedEffect(viewModel) {
        viewModel.navigation.collect {
            when (it) {
                is PageEvent.Moved -> onMoved(it.productId)
                PageEvent.Deleted -> onBack()
            }
        }
    }
    // Deleted from its editor, or merged by someone else: nothing to show.
    if (state.loaded && state.page == null) LaunchedEffect(Unit) { onBack() }
    val page = state.page ?: return
    ProductPageScreen(
        page = page,
        isAdmin = isAdmin,
        now = viewModel.now(),
        actions =
            ProductPageActions(
                onBack = onBack,
                onEdit = { onEdit(page.id) },
                onAddVariant = { onOpenVariant(page.id, null) },
                onOpenVariant = { onOpenVariant(page.id, it) },
                onMergeProduct = viewModel::startProductMerge,
                onMergeVariant = viewModel::startVariantMerge,
                onDelete = viewModel::askDelete,
            ),
        history = HistoryTabState(historyVariantId, historyFilter, history, viewModel::pickHistoryVariant, viewModel::onHistoryFilter),
    )
    merge?.let { MergeSheet(it, candidates, viewModel::onMergeQuery, viewModel::pickTarget, viewModel::confirmMerge, viewModel::cancelMerge) }
    message?.let { MergeMessage(it, viewModel::dismissMessage) }
    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = viewModel::dismissDelete,
            text = { Text(stringResource(R.string.editor_delete_product_confirm, page.name)) },
            confirmButton = { TextButton(onClick = viewModel::delete) { Text(stringResource(R.string.editor_delete), color = MaterialTheme.colorScheme.error) } },
            dismissButton = { TextButton(onClick = viewModel::dismissDelete) { Text(stringResource(R.string.editor_cancel)) } },
        )
    }
}

/**
 * S-08 (05 §5): the variants with their latest prices, the comparator variant × store (RF-PRE-04) and the price
 * history (RF-PRE-02). Photos arrive with T-117 and shelf prices with T-125.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ProductPageScreen(
    page: ProductPage,
    isAdmin: Boolean,
    now: Long,
    actions: ProductPageActions,
    history: HistoryTabState = HistoryTabState(),
) {
    var tab by rememberSaveable { mutableIntStateOf(0) }
    LazyColumn(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        item {
            Column(Modifier.padding(horizontal = Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    IconButton(onClick = actions.onBack) {
                        Icon(painterResource(DesignR.drawable.ic_arrow_back), contentDescription = stringResource(R.string.editor_back))
                    }
                    Text(page.name, style = MaterialTheme.typography.headlineSmall, modifier = Modifier.semantics { heading() })
                }
                page.photo?.let { ProductPhoto(it, page.name, Modifier.fillMaxWidth().height(220.dp), contentScale = ContentScale.Fit) }
                listOfNotNull(page.brand, page.categoryPath).takeIf { it.isNotEmpty() }?.let {
                    Text(it.joinToString(" · "), style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (page.tags.isNotEmpty()) {
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                        page.tags.forEach { tag ->
                            Surface(color = MaterialTheme.colorScheme.secondaryContainer, shape = MaterialTheme.shapes.small) {
                                Text(tag, style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(horizontal = Spacing.sm, vertical = Spacing.xs))
                            }
                        }
                    }
                }
                FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    ActionButton(R.string.page_edit, actions.onEdit)
                    ActionButton(R.string.editor_add_variant, actions.onAddVariant)
                    if (isAdmin) {
                        ActionButton(R.string.page_merge, actions.onMergeProduct)
                        ActionButton(R.string.page_delete, actions.onDelete)
                    }
                }
            }
        }
        item {
            PrimaryTabRow(selectedTabIndex = tab) {
                listOf(R.string.page_tab_variants, R.string.page_tab_compare, R.string.page_tab_history).forEachIndexed { i, label ->
                    Tab(selected = tab == i, onClick = { tab = i }, text = { Text(stringResource(label)) })
                }
            }
        }
        if (tab == 0) {
            items(page.variants, key = { it.id }) { VariantCard(it, isAdmin, now, actions) }
        } else if (tab == 2) {
            historyTab(page.variants, history, now)
        } else {
            val (comparable, others) = page.comparison.partition { it.comparable }
            if (page.comparison.isEmpty()) item { Text(stringResource(R.string.page_compare_empty), modifier = Modifier.padding(horizontal = Spacing.lg)) }
            items(comparable, key = { "${it.variantId}:${it.storeId}" }) { CompareCard(it, now) }
            if (others.isNotEmpty()) {
                item {
                    Text(
                        stringResource(R.string.page_compare_other),
                        style = MaterialTheme.typography.titleMedium,
                        modifier = Modifier.padding(horizontal = Spacing.lg).semantics { heading() },
                    )
                }
                items(others, key = { "${it.variantId}:${it.storeId}" }) { CompareCard(it, now) }
            }
        }
        item { Column(Modifier.heightIn(min = Spacing.xl)) {} }
    }
}

@Composable
private fun ActionButton(
    label: Int,
    onClick: () -> Unit,
) {
    OutlinedButton(onClick = onClick, modifier = Modifier.heightIn(min = Spacing.touchTarget)) { Text(stringResource(label)) }
}

@Composable
private fun VariantCard(
    variant: PageVariant,
    isAdmin: Boolean,
    now: Long,
    actions: ProductPageActions,
) {
    Card(Modifier.fillMaxWidth().padding(horizontal = Spacing.lg).clickable { actions.onOpenVariant(variant.id) }) {
        Column(Modifier.padding(Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Text(variant.label, style = MaterialTheme.typography.titleMedium)
            if (variant.content != variant.label) Text(variant.content, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (variant.codes.isNotEmpty()) {
                Text(stringResource(R.string.page_codes, variant.codes.joinToString(", ")), style = MaterialTheme.typography.bodyMedium)
            }
            if (variant.latest.isEmpty()) Text(stringResource(R.string.page_no_prices), style = MaterialTheme.typography.bodyMedium)
            variant.latest.forEach { LatestPrice(it, now) }
            if (isAdmin) {
                TextButton(onClick = { actions.onMergeVariant(variant) }, modifier = Modifier.heightIn(min = Spacing.touchTarget)) {
                    Text(stringResource(R.string.page_merge_variant))
                }
            }
        }
    }
}

@Composable
private fun LatestPrice(
    price: PagePrice,
    now: Long,
) {
    val source = PriceSource.fromWire(price.source) ?: return
    Column(Modifier.semantics(mergeDescendants = true) {}) {
        val paid = price.effectiveUnitCents
        if (paid != null) PriceText(cents = paid, perUnitCents = price.displayCents, unit = price.unit, source = source) else UnitPriceText(price.displayCents, price.unit, source)
        Text(
            stringResource(R.string.page_price_at, price.storeName ?: stringResource(R.string.catalog_unknown_store), Dates.ago(price.observedAt, now)),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun CompareCard(
    row: PageComparison,
    now: Long,
) {
    val colors = if (row.best) CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer) else CardDefaults.cardColors()
    Card(Modifier.fillMaxWidth().padding(horizontal = Spacing.lg), colors = colors) {
        Column(Modifier.padding(Spacing.lg).semantics(mergeDescendants = true) {}, verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            if (row.best) Text(stringResource(R.string.page_compare_cheapest), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onPrimaryContainer)
            Text(
                stringResource(R.string.page_row_title, row.variantLabel, row.storeName ?: stringResource(R.string.catalog_unknown_store)),
                style = MaterialTheme.typography.titleMedium,
            )
            val source = PriceSource.fromWire(row.last.source)
            Text(stringResource(R.string.page_compare_last), style = MaterialTheme.typography.labelLarge)
            if (source != null) UnitPriceText(row.last.displayCents, row.unit, source)
            Text(Dates.ago(row.last.observedAt, now), style = MaterialTheme.typography.bodyMedium)
            CompareLine(R.string.page_compare_min, row.minCents, row)
            CompareLine(R.string.page_compare_avg, row.avgCents, row, pluralStringResource(R.plurals.page_compare_n, row.n, row.n))
        }
    }
}

@Composable
private fun CompareLine(
    label: Int,
    cents: Long,
    row: PageComparison,
    extra: String? = null,
) {
    val value = stringResource(DesignR.string.ds_per_unit, Money.format(cents), row.unit.label())
    Text(listOfNotNull("${stringResource(label)}: $value", extra).joinToString(" · "), style = MaterialTheme.typography.bodyLarge)
}
