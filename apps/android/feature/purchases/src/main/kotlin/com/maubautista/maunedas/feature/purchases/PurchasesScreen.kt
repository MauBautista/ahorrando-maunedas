package com.maubautista.maunedas.feature.purchases

import androidx.annotation.StringRes
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DateRangePicker
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDateRangePickerState
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
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.paging.LoadState
import androidx.paging.compose.LazyPagingItems
import androidx.paging.compose.collectAsLazyPagingItems
import androidx.paging.compose.itemKey
import com.maubautista.maunedas.core.data.PurchaseSummary
import com.maubautista.maunedas.core.data.StoreOption
import com.maubautista.maunedas.core.designsystem.Spacing
import com.maubautista.maunedas.core.model.Money
import com.maubautista.maunedas.core.ui.Dates
import com.maubautista.maunedas.core.ui.clock24h
import com.maubautista.maunedas.core.designsystem.R as DesignR

/** What the purchases screen can ask for. */
data class PurchasesActions(
    val onStore: (StoreOption?) -> Unit = {},
    val onRange: (DateRange) -> Unit = {},
    val onStatus: (String?) -> Unit = {},
    val onOpenPurchase: (String) -> Unit = {},
    val onNewPurchase: () -> Unit = {},
)

@Composable
fun PurchasesRoute(
    onOpenPurchase: (String) -> Unit,
    onNewPurchase: () -> Unit,
    viewModel: PurchasesViewModel = hiltViewModel(),
) {
    val filters by viewModel.filters.collectAsStateWithLifecycle()
    val stores by viewModel.stores.collectAsStateWithLifecycle()
    val hasPurchases by viewModel.hasPurchases.collectAsStateWithLifecycle()
    PurchasesScreen(
        filters = filters,
        items = viewModel.items.collectAsLazyPagingItems(),
        stores = stores,
        hasPurchases = hasPurchases,
        now = viewModel.now(),
        actions = PurchasesActions(viewModel::onStore, viewModel::onRange, viewModel::onStatus, onOpenPurchase, onNewPurchase),
    )
}

private enum class Sheet { STORE, DATES, STATUS }

/** S-03 (05 §5): purchases grouped by day, filtered by store, dates and status. */
@Composable
fun PurchasesScreen(
    filters: PurchaseFilters,
    items: LazyPagingItems<PurchaseListItem>,
    stores: List<StoreOption>,
    hasPurchases: Boolean?,
    now: Long,
    actions: PurchasesActions,
) {
    var sheet by rememberSaveable { mutableStateOf<Sheet?>(null) }
    var pickDays by rememberSaveable { mutableStateOf(false) }
    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            Row(
                Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = Spacing.lg, vertical = Spacing.sm),
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                FilterButton(filters.store?.name ?: stringResource(R.string.purchases_store), filters.store != null) { sheet = Sheet.STORE }
                FilterButton(rangeLabel(filters.range, now) ?: stringResource(R.string.purchases_dates), filters.range != DateRange.All) { sheet = Sheet.DATES }
                FilterButton(statusLabel(filters.status)?.let { stringResource(it) } ?: stringResource(R.string.purchases_status), filters.status != null) { sheet = Sheet.STATUS }
            }
            val loaded = items.loadState.refresh is LoadState.NotLoading
            when {
                hasPurchases == false -> Message(stringResource(R.string.purchases_empty))
                hasPurchases == true && loaded && items.itemCount == 0 -> Message(stringResource(R.string.purchases_no_match))
                else ->
                    // Room at the bottom so the button does not cover the last purchase.
                    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 96.dp)) {
                        items(items.itemCount, key = items.itemKey { it.key }) { i ->
                            when (val item = items[i]) {
                                is PurchaseListItem.Day -> DayHeading(item, now)
                                is PurchaseListItem.Row -> PurchaseRow(item.purchase) { actions.onOpenPurchase(item.purchase.id) }
                                null -> Unit
                            }
                        }
                    }
            }
        }
        ExtendedFloatingActionButton(onClick = actions.onNewPurchase, modifier = Modifier.align(Alignment.BottomEnd).padding(Spacing.lg)) {
            Text(stringResource(R.string.purchases_new))
        }
    }
    when (sheet) {
        Sheet.STORE ->
            OptionsSheet(
                options = listOf(null to stringResource(R.string.purchases_all_stores)) + stores.map { it to it.name },
                selected = filters.store,
                onPick = { actions.onStore(it); sheet = null },
                onDismiss = { sheet = null },
            )
        Sheet.DATES ->
            OptionsSheet(
                options =
                    listOf(
                        DateRange.All to stringResource(R.string.purchases_all_dates),
                        DateRange.ThisMonth to stringResource(R.string.purchases_this_month),
                        DateRange.LastMonth to stringResource(R.string.purchases_last_month),
                        DateRange.LastThreeMonths to stringResource(R.string.purchases_last_three_months),
                        null to stringResource(R.string.purchases_pick_dates),
                    ),
                selected = filters.range.takeUnless { it is DateRange.Days },
                onPick = { range ->
                    sheet = null
                    if (range == null) pickDays = true else actions.onRange(range)
                },
                onDismiss = { sheet = null },
            )
        Sheet.STATUS ->
            OptionsSheet(
                options = listOf(null to stringResource(R.string.purchases_all_status), "draft" to stringResource(R.string.purchases_drafts), "confirmed" to stringResource(R.string.purchases_confirmed)),
                selected = filters.status,
                onPick = { actions.onStatus(it); sheet = null },
                onDismiss = { sheet = null },
            )
        null -> Unit
    }
    if (pickDays) DaysPicker(onPick = { actions.onRange(it); pickDays = false }, onDismiss = { pickDays = false })
}

@Composable
private fun rangeLabel(
    range: DateRange,
    now: Long,
): String? =
    when (range) {
        DateRange.All -> null
        DateRange.ThisMonth -> stringResource(R.string.purchases_this_month)
        DateRange.LastMonth -> stringResource(R.string.purchases_last_month)
        DateRange.LastThreeMonths -> stringResource(R.string.purchases_last_three_months)
        is DateRange.Days -> stringResource(R.string.purchases_custom_dates, Dates.shortDateOfDay(range.first.toEpochDay(), now), Dates.shortDateOfDay(range.last.toEpochDay(), now))
    }

@StringRes
private fun statusLabel(status: String?): Int? =
    when (status) {
        "draft" -> R.string.purchases_drafts
        "confirmed" -> R.string.purchases_confirmed
        else -> null
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
private fun DayHeading(
    day: PurchaseListItem.Day,
    now: Long,
) {
    Text(
        Dates.dayTitle(day.at, now),
        style = MaterialTheme.typography.titleSmall,
        color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.fillMaxWidth().padding(start = Spacing.lg, end = Spacing.lg, top = Spacing.lg, bottom = Spacing.xs).semantics { heading() },
    )
}

@Composable
private fun PurchaseRow(
    purchase: PurchaseSummary,
    onClick: () -> Unit,
) {
    val store = purchase.storeName ?: stringResource(R.string.purchases_unknown_store)
    val time = Dates.time(purchase.purchasedAt, clock24h())
    Column {
        Row(
            Modifier
                .fillMaxWidth()
                .heightIn(min = Spacing.touchTarget)
                .clickable(onClick = onClick)
                .padding(horizontal = Spacing.lg, vertical = Spacing.sm)
                .semantics(mergeDescendants = true) {},
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            Column(Modifier.weight(1f)) {
                Text(listOfNotNull(store, purchase.branchName).joinToString(" · "), style = MaterialTheme.typography.bodyLarge)
                Text(
                    "$time · ${pluralStringResource(R.plurals.purchases_lines, purchase.lineCount, purchase.lineCount)}",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Column(horizontalAlignment = Alignment.End) {
                Text(Money.format(purchase.totalCents), style = MaterialTheme.typography.bodyLarge)
                if (purchase.draft) {
                    Surface(color = MaterialTheme.colorScheme.secondaryContainer, shape = MaterialTheme.shapes.small) {
                        Text(
                            stringResource(R.string.purchases_draft),
                            style = MaterialTheme.typography.labelMedium,
                            modifier = Modifier.padding(horizontal = Spacing.sm, vertical = Spacing.xs),
                        )
                    }
                }
            }
        }
        HorizontalDivider(Modifier.padding(horizontal = Spacing.lg))
    }
}

/** A single choice; the first option is usually "all". */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun <T> OptionsSheet(
    options: List<Pair<T, String>>,
    selected: T,
    onPick: (T) -> Unit,
    onDismiss: () -> Unit,
) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        LazyColumn(Modifier.padding(bottom = Spacing.xl)) {
            items(options.size) { i ->
                val (value, label) = options[i]
                Row(
                    Modifier
                        .fillMaxWidth()
                        .heightIn(min = Spacing.touchTarget)
                        .clickable(role = Role.RadioButton) { onPick(value) }
                        .padding(horizontal = Spacing.lg),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Spacing.md),
                ) {
                    RadioButton(selected = value == selected, onClick = null)
                    Text(label, style = MaterialTheme.typography.bodyLarge)
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DaysPicker(
    onPick: (DateRange.Days) -> Unit,
    onDismiss: () -> Unit,
) {
    val state = rememberDateRangePickerState()
    val start = state.selectedStartDateMillis
    val end = state.selectedEndDateMillis
    DatePickerDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            TextButton(onClick = { if (start != null && end != null) onPick(DateRange.Days.fromPicker(start, end)) }, enabled = start != null && end != null) {
                Text(stringResource(R.string.purchases_ok))
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.purchases_cancel)) } },
    ) {
        DateRangePicker(state = state, modifier = Modifier.weight(1f))
    }
}
