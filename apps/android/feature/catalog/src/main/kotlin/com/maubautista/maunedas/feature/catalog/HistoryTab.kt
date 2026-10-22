package com.maubautista.maunedas.feature.catalog

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import com.maubautista.maunedas.core.data.HistoryFilter
import com.maubautista.maunedas.core.data.HistoryPeriod
import com.maubautista.maunedas.core.data.HistoryPoint
import com.maubautista.maunedas.core.data.PageVariant
import com.maubautista.maunedas.core.data.VariantHistory
import com.maubautista.maunedas.core.designsystem.MaunedasTheme
import com.maubautista.maunedas.core.designsystem.Spacing
import com.maubautista.maunedas.core.designsystem.component.PriceSource
import com.maubautista.maunedas.core.designsystem.component.PriceText
import com.maubautista.maunedas.core.designsystem.component.UnitPriceText
import com.maubautista.maunedas.core.ui.Dates
import com.maubautista.maunedas.core.designsystem.R as DesignR

/** What the history tab shows and can change (RF-PRE-02). */
data class HistoryTabState(
    val variantId: String? = null,
    val filter: HistoryFilter = HistoryFilter(),
    val history: VariantHistory? = null,
    val onVariant: (String) -> Unit = {},
    val onFilter: ((HistoryFilter) -> HistoryFilter) -> Unit = {},
)

/** S-08 "Historial": variant, sources, period and store; the chart, then every price (newest first) for reading. */
fun LazyListScope.historyTab(
    variants: List<PageVariant>,
    tab: HistoryTabState,
    now: Long,
) {
    item { HistoryFilters(variants, tab) }
    val history = tab.history ?: return
    if (history.points.isEmpty()) {
        item { Text(stringResource(R.string.history_empty), modifier = Modifier.padding(horizontal = Spacing.lg)) }
        return
    }
    item { HistoryChart(history, now, Modifier.padding(horizontal = Spacing.lg)) }
    item {
        Text(stringResource(R.string.history_prices), style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(horizontal = Spacing.lg).semantics { heading() })
    }
    items(history.points.reversed(), key = { it.pointId }) { HistoryRow(it, history, now) }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun HistoryFilters(
    variants: List<PageVariant>,
    tab: HistoryTabState,
) {
    var pickStore by rememberSaveable { mutableStateOf(false) }
    Column(Modifier.padding(horizontal = Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        if (variants.size > 1) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                variants.forEach { v -> FilterChip(selected = v.id == tab.variantId, onClick = { tab.onVariant(v.id) }, label = { Text(v.label) }) }
            }
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            PriceSource.entries.forEach { source ->
                val on = source.wire in tab.filter.sources
                FilterChip(
                    selected = on,
                    onClick = { tab.onFilter { f -> f.copy(sources = if (on) f.sources - source.wire else f.sources + source.wire) } },
                    label = { Text(stringResource(source.labelRes())) },
                    leadingIcon = { Box(Modifier.size(Spacing.md).background(source.color(), CircleShape)) },
                )
            }
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            listOf(HistoryPeriod.THREE_MONTHS to R.string.history_period_3m, HistoryPeriod.YEAR to R.string.history_period_year, HistoryPeriod.ALL to R.string.history_period_all)
                .forEach { (period, label) ->
                    FilterChip(selected = tab.filter.period == period, onClick = { tab.onFilter { it.copy(period = period) } }, label = { Text(stringResource(label)) })
                }
        }
        val stores = tab.history?.stores.orEmpty()
        if (stores.size > 1) {
            OutlinedButton(onClick = { pickStore = true }, modifier = Modifier.fillMaxWidth().heightIn(min = Spacing.touchTarget)) {
                Text(stores.firstOrNull { it.id == tab.filter.storeId }?.name ?: stringResource(R.string.history_all_stores))
            }
        }
        if (pickStore) {
            ChoiceSheet(
                allLabel = stringResource(R.string.history_all_stores),
                options = stores.map { Choice(it.id, it.name ?: stringResource(R.string.catalog_unknown_store), 0) },
                selected = tab.filter.storeId,
                emptyLabel = null,
                onPick = { id -> tab.onFilter { it.copy(storeId = id) }; pickStore = false },
                onDismiss = { pickStore = false },
            )
        }
    }
}

@Composable
private fun HistoryRow(
    point: HistoryPoint,
    history: VariantHistory,
    now: Long,
) {
    val source = PriceSource.fromWire(point.source) ?: return
    Column(Modifier.fillMaxWidth().padding(horizontal = Spacing.lg, vertical = Spacing.xs).semantics(mergeDescendants = true) {}) {
        Text(
            stringResource(R.string.history_point, Dates.shortDate(point.observedAt, now), point.storeName ?: stringResource(R.string.catalog_unknown_store)),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        val paid = point.effectiveUnitCents
        if (paid != null) PriceText(cents = paid, perUnitCents = point.displayCents, unit = history.unit, source = source) else UnitPriceText(point.displayCents, history.unit, source)
        if (point.hasPromo) Text(stringResource(R.string.history_promo), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
        HorizontalDivider(Modifier.padding(top = Spacing.sm))
    }
}

private fun PriceSource.labelRes(): Int =
    when (this) {
        PriceSource.PURCHASE -> DesignR.string.ds_source_purchase
        PriceSource.SHELF -> DesignR.string.ds_source_shelf
        PriceSource.WEB -> DesignR.string.ds_source_web
    }

@Composable
private fun PriceSource.color() =
    when (this) {
        PriceSource.PURCHASE -> MaunedasTheme.extended.purchase
        PriceSource.SHELF -> MaunedasTheme.extended.shelf
        PriceSource.WEB -> MaunedasTheme.extended.web
    }
