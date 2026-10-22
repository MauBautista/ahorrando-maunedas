package com.maubautista.maunedas.feature.catalog

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.paging.LoadState
import androidx.paging.compose.LazyPagingItems
import androidx.paging.compose.collectAsLazyPagingItems
import androidx.paging.compose.itemKey
import com.maubautista.maunedas.core.data.CatalogItem
import com.maubautista.maunedas.core.data.CategoryNode
import com.maubautista.maunedas.core.data.TagItem
import com.maubautista.maunedas.core.designsystem.Spacing
import com.maubautista.maunedas.core.designsystem.component.PriceSource
import com.maubautista.maunedas.core.designsystem.component.UnitPriceText
import com.maubautista.maunedas.core.ui.Dates
import com.maubautista.maunedas.core.designsystem.R as DesignR

/** What the catalog screen can ask for. */
data class CatalogActions(
    val onQueryChange: (String) -> Unit = {},
    val onCategory: (CategoryNode?) -> Unit = {},
    val onTag: (TagItem?) -> Unit = {},
    val onOpenProduct: (String) -> Unit = {},
)

@Composable
fun CatalogRoute(
    onOpenProduct: (String) -> Unit,
    viewModel: CatalogViewModel = hiltViewModel(),
) {
    val filters by viewModel.filters.collectAsStateWithLifecycle()
    val categories by viewModel.categories.collectAsStateWithLifecycle()
    val tags by viewModel.tags.collectAsStateWithLifecycle()
    val hasProducts by viewModel.hasProducts.collectAsStateWithLifecycle()
    CatalogScreen(
        filters = filters,
        products = viewModel.products.collectAsLazyPagingItems(),
        categories = categories,
        tags = tags,
        hasProducts = hasProducts,
        now = viewModel.now(),
        actions = CatalogActions(viewModel::onQueryChange, viewModel::onCategory, viewModel::onTag, onOpenProduct),
    )
}

private enum class Sheet { CATEGORY, TAG }

/** S-07 (05 §5): search by `search_key`, category (with subcategories) and tag filters, best price per card. */
@Composable
fun CatalogScreen(
    filters: CatalogFilters,
    products: LazyPagingItems<CatalogItem>,
    categories: List<CategoryNode>,
    tags: List<TagItem>,
    hasProducts: Boolean?,
    now: Long,
    actions: CatalogActions,
) {
    var sheet by rememberSaveable { mutableStateOf<Sheet?>(null) }
    Column(Modifier.fillMaxSize()) {
        OutlinedTextField(
            value = filters.query,
            onValueChange = actions.onQueryChange,
            label = { Text(stringResource(R.string.catalog_search)) },
            leadingIcon = { Icon(painterResource(DesignR.drawable.ic_search), contentDescription = null) },
            trailingIcon = {
                if (filters.query.isNotEmpty()) {
                    IconButton(onClick = { actions.onQueryChange("") }) {
                        Icon(painterResource(DesignR.drawable.ic_close), contentDescription = stringResource(R.string.catalog_clear_search))
                    }
                }
            },
            singleLine = true,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.lg, vertical = Spacing.sm),
        )
        Row(
            Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = Spacing.lg),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            FilterButton(filters.category?.name ?: stringResource(R.string.catalog_category), filters.category != null) { sheet = Sheet.CATEGORY }
            FilterButton(filters.tag?.name ?: stringResource(R.string.catalog_tag), filters.tag != null) { sheet = Sheet.TAG }
        }
        val loaded = products.loadState.refresh is LoadState.NotLoading
        when {
            hasProducts == false -> Message(stringResource(R.string.catalog_empty))
            hasProducts == true && loaded && products.itemCount == 0 -> Message(stringResource(R.string.catalog_no_match))
            else ->
                LazyColumn(Modifier.fillMaxSize()) {
                    items(products.itemCount, key = products.itemKey { it.id }) { i ->
                        products[i]?.let { item ->
                            if (i > 0) HorizontalDivider(Modifier.padding(horizontal = Spacing.lg))
                            ProductCard(item, now) { actions.onOpenProduct(item.id) }
                        }
                    }
                }
        }
    }
    when (sheet) {
        Sheet.CATEGORY ->
            ChoiceSheet(
                allLabel = stringResource(R.string.catalog_all_categories),
                options = categories.map { Choice(it.id, it.name, it.depth) },
                selected = filters.category?.id,
                emptyLabel = null,
                onPick = { id -> actions.onCategory(categories.firstOrNull { it.id == id }); sheet = null },
                onDismiss = { sheet = null },
            )
        Sheet.TAG ->
            ChoiceSheet(
                allLabel = stringResource(R.string.catalog_all_tags),
                options = tags.map { Choice(it.id, it.name, 0) },
                selected = filters.tag?.id,
                emptyLabel = stringResource(R.string.catalog_no_tags),
                onPick = { id -> actions.onTag(tags.firstOrNull { it.id == id }); sheet = null },
                onDismiss = { sheet = null },
            )
        null -> Unit
    }
}

@Composable
private fun FilterButton(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
) {
    FilterChip(
        selected = selected,
        onClick = onClick,
        label = { Text(label) },
        trailingIcon = { Icon(painterResource(DesignR.drawable.ic_arrow_drop_down), contentDescription = null) },
        modifier = Modifier.heightIn(min = Spacing.touchTarget),
    )
}

@Composable
private fun Message(text: String) {
    Text(text, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(Spacing.xl))
}

@Composable
private fun ProductCard(
    item: CatalogItem,
    now: Long,
    onClick: () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = Spacing.lg, vertical = Spacing.md)
            .semantics(mergeDescendants = true) {},
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        // The photo arrives with T-117; until then the initial stands in for it.
        Surface(color = MaterialTheme.colorScheme.secondaryContainer, shape = MaterialTheme.shapes.medium, modifier = Modifier.size(56.dp)) {
            Box(contentAlignment = Alignment.Center) {
                Text(item.name.take(1).uppercase(), style = MaterialTheme.typography.titleLarge)
            }
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Text(item.name, style = MaterialTheme.typography.titleMedium)
            Text(
                listOfNotNull(item.brand, pluralStringResource(R.plurals.catalog_variants, item.variants, item.variants)).joinToString(" · "),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            val best = item.best
            val source = best?.let { PriceSource.fromWire(it.source) }
            if (best != null && source != null) {
                UnitPriceText(best.displayCents, best.unit, source)
                Text(
                    stringResource(
                        R.string.catalog_best_detail,
                        best.variantLabel,
                        best.storeName ?: stringResource(R.string.catalog_unknown_store),
                        Dates.ago(best.observedAt, now),
                    ),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else {
                Text(stringResource(R.string.catalog_no_price), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

private data class Choice(
    val id: String,
    val label: String,
    val depth: Int,
)

/** A single choice with "all" on top; subcategories are indented under their parent. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ChoiceSheet(
    allLabel: String,
    options: List<Choice>,
    selected: String?,
    emptyLabel: String?,
    onPick: (String?) -> Unit,
    onDismiss: () -> Unit,
) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        LazyColumn(Modifier.padding(bottom = Spacing.xl)) {
            item { ChoiceRow(allLabel, 0, selected == null) { onPick(null) } }
            if (options.isEmpty() && emptyLabel != null) item { Message(emptyLabel) }
            items(options, key = { it.id }) { ChoiceRow(it.label, it.depth, it.id == selected) { onPick(it.id) } }
        }
    }
}

@Composable
private fun ChoiceRow(
    label: String,
    depth: Int,
    selected: Boolean,
    onClick: () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = Spacing.touchTarget)
            .clickable(role = Role.RadioButton, onClick = onClick)
            .padding(start = Spacing.lg + Spacing.xl * depth, end = Spacing.lg),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        RadioButton(selected = selected, onClick = null)
        Text(label, style = MaterialTheme.typography.bodyLarge)
    }
}
