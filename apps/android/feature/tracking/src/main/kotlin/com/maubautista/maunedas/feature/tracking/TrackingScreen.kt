package com.maubautista.maunedas.feature.tracking

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.RadioButton
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextDecoration
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.maubautista.maunedas.core.data.ListingHealth
import com.maubautista.maunedas.core.data.TrackedListing
import com.maubautista.maunedas.core.designsystem.Spacing
import com.maubautista.maunedas.core.model.Money
import com.maubautista.maunedas.core.ui.Dates
import com.maubautista.maunedas.core.designsystem.R as DesignR

/** What the tracking list can do; the app wires navigation. */
data class TrackingActions(
    val onBack: (() -> Unit)? = null,
    val onAdd: () -> Unit = {},
    val onOpenProduct: (productId: String) -> Unit = {},
    val onCheckNow: (TrackedListing) -> Unit = {},
    val onToggle: (TrackedListing) -> Unit = {},
    val onStop: (TrackedListing) -> Unit = {},
    val onOpenAlerts: (variantId: String) -> Unit = {},
    val onInterval: (TrackedListing) -> Unit = {},
)

/** S-20 inside Catálogo (05 §4), or for one variant from its product page ([onBack] then shows a back arrow). */
@Composable
fun TrackingRoute(
    onOpenProduct: (productId: String) -> Unit,
    onAdd: (variantId: String?) -> Unit,
    onBack: (() -> Unit)? = null,
    onOpenAlerts: (variantId: String) -> Unit = {},
    viewModel: TrackingViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val confirm by viewModel.confirmStop.collectAsStateWithLifecycle()
    val intervalFor by viewModel.intervalFor.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    // Prepared here, so the text follows the configuration (the store's name goes in when it arrives).
    val asked = stringResource(R.string.tracking_check_asked, "%s")
    LaunchedEffect(viewModel) {
        viewModel.checkAsked.collect { store -> snackbar.showSnackbar(asked.replace("%s", store)) }
    }
    Column(Modifier.fillMaxSize()) {
        TrackingScreen(
            state = state,
            now = viewModel.now(),
            actions =
                TrackingActions(
                    onBack = onBack,
                    onAdd = { onAdd(state.variantId) },
                    onOpenProduct = onOpenProduct,
                    onCheckNow = viewModel::checkNow,
                    onToggle = viewModel::toggle,
                    onStop = viewModel::askStop,
                    onOpenAlerts = onOpenAlerts,
                    onInterval = viewModel::askInterval,
                ),
            modifier = Modifier.weight(1f),
        )
        SnackbarHost(snackbar)
    }
    intervalFor?.let { IntervalDialog(it, onPick = viewModel::setInterval, onDismiss = viewModel::dismissInterval) }
    confirm?.let { listing ->
        AlertDialog(
            onDismissRequest = viewModel::dismissStop,
            text = { Text(stringResource(R.string.tracking_stop_confirm, "${listing.productName} · ${listing.variantLabel}", listing.storeName)) },
            confirmButton = { TextButton(onClick = viewModel::stop) { Text(stringResource(R.string.tracking_stop), color = MaterialTheme.colorScheme.error) } },
            dismissButton = { TextButton(onClick = viewModel::dismissStop) { Text(stringResource(R.string.tracking_cancel)) } },
        )
    }
}

@Composable
fun TrackingScreen(
    state: TrackingState,
    now: Long,
    actions: TrackingActions,
    modifier: Modifier = Modifier,
) {
    val groups = state.listings.groupBy { it.variantId }.values.toList()
    LazyColumn(modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        item {
            Column(Modifier.padding(horizontal = Spacing.lg, vertical = Spacing.sm), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    actions.onBack?.let { back ->
                        IconButton(onClick = back) {
                            Icon(painterResource(DesignR.drawable.ic_arrow_back), contentDescription = stringResource(R.string.tracking_back))
                        }
                    }
                    Text(stringResource(R.string.tracking_title), style = MaterialTheme.typography.titleLarge, modifier = Modifier.semantics { heading() })
                }
                state.variantName?.let { Text(stringResource(R.string.tracking_only, it), style = MaterialTheme.typography.bodyMedium) }
                state.agent?.takeIf { !it.online(now) }?.lastHeartbeatAt?.let { at ->
                    Surface(color = MaterialTheme.colorScheme.errorContainer, shape = MaterialTheme.shapes.small) {
                        Text(
                            stringResource(R.string.tracking_agent_offline, Dates.agoTime(at, now)),
                            style = MaterialTheme.typography.bodyMedium,
                            modifier = Modifier.padding(Spacing.md),
                        )
                    }
                }
                Button(onClick = actions.onAdd, modifier = Modifier.heightIn(min = Spacing.touchTarget)) { Text(stringResource(R.string.tracking_add)) }
                if (!state.loading && state.listings.isEmpty()) {
                    Text(stringResource(R.string.tracking_empty), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        groups.forEach { group ->
            val first = group.first()
            item(key = "variant:${first.variantId}") {
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = Spacing.lg),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        "${first.productName} · ${first.variantLabel}",
                        style = MaterialTheme.typography.titleMedium,
                        modifier = Modifier.weight(1f).clickable { actions.onOpenProduct(first.productId) }.semantics { heading() },
                    )
                    TextButton(onClick = { actions.onOpenAlerts(first.variantId) }) { Text(stringResource(R.string.alerts_title_short)) }
                }
            }
            items(group, key = { it.id }) { ListingCard(it, now, actions) }
        }
        item { Column(Modifier.heightIn(min = Spacing.xl)) {} }
    }
}

private val HEALTH_LABEL =
    mapOf(
        ListingHealth.PAUSED to R.string.tracking_health_paused,
        ListingHealth.WAITING to R.string.tracking_health_waiting,
        ListingHealth.OK to R.string.tracking_health_ok,
        ListingHealth.OUT_OF_STOCK to R.string.tracking_health_out_of_stock,
        ListingHealth.NOT_FOUND to R.string.tracking_health_not_found,
        ListingHealth.BLOCKED to R.string.tracking_health_blocked,
        ListingHealth.ERROR to R.string.tracking_health_error,
    )

private val HEALTH_HELP =
    mapOf(
        ListingHealth.PAUSED to R.string.tracking_help_paused,
        ListingHealth.WAITING to R.string.tracking_help_waiting,
        ListingHealth.NOT_FOUND to R.string.tracking_help_not_found,
        ListingHealth.BLOCKED to R.string.tracking_help_blocked,
        ListingHealth.ERROR to R.string.tracking_help_error,
    )

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ListingCard(
    listing: TrackedListing,
    now: Long,
    actions: TrackingActions,
) {
    val uri = LocalUriHandler.current
    val troubled = listing.health in setOf(ListingHealth.BLOCKED, ListingHealth.ERROR, ListingHealth.NOT_FOUND)
    Card(Modifier.fillMaxWidth().padding(horizontal = Spacing.lg)) {
        Column(Modifier.padding(Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text(listing.storeName, style = MaterialTheme.typography.titleSmall)
                Surface(
                    color = if (troubled) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.secondaryContainer,
                    shape = MaterialTheme.shapes.small,
                ) {
                    Text(
                        stringResource(HEALTH_LABEL.getValue(listing.health)),
                        style = MaterialTheme.typography.labelLarge,
                        modifier = Modifier.padding(horizontal = Spacing.sm, vertical = Spacing.xs),
                    )
                }
            }
            listing.priceCents?.let { price ->
                FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalArrangement = Arrangement.Center) {
                    Text(Money.format(price), style = MaterialTheme.typography.titleLarge)
                    listing.listPriceCents?.let { list ->
                        val before = stringResource(R.string.tracking_list_price, Money.format(list))
                        Text(
                            Money.format(list),
                            style = MaterialTheme.typography.bodyMedium,
                            textDecoration = TextDecoration.LineThrough,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.semantics { contentDescription = before },
                        )
                    }
                    if (listing.health == ListingHealth.OUT_OF_STOCK) Text(stringResource(R.string.tracking_last_price), style = MaterialTheme.typography.bodyMedium)
                }
            }
            listing.promoText?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.primary) }
            val checked = listing.lastCheckedAt?.let { stringResource(R.string.tracking_checked, Dates.agoTime(it, now)) } ?: stringResource(R.string.tracking_not_checked)
            val every =
                listing.intervalMin?.let { m ->
                    if (m % 60 == 0L) stringResource(R.string.tracking_every_hours, (m / 60).toInt()) else stringResource(R.string.tracking_every_minutes, m.toInt())
                }
            val requested = if (listing.checkRequested) stringResource(R.string.tracking_requested) else null
            Text(listOfNotNull(checked, every, requested).joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            HEALTH_HELP[listing.health]?.let { Text(stringResource(it), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                OutlinedButton(
                    onClick = { actions.onCheckNow(listing) },
                    enabled = listing.active && !listing.checkRequested,
                    modifier = Modifier.heightIn(min = Spacing.touchTarget),
                ) { Text(stringResource(R.string.tracking_check_now)) }
                TextButton(onClick = { actions.onToggle(listing) }, modifier = Modifier.heightIn(min = Spacing.touchTarget)) {
                    Text(stringResource(if (listing.active) R.string.tracking_pause else R.string.tracking_resume))
                }
                TextButton(onClick = { actions.onInterval(listing) }, modifier = Modifier.heightIn(min = Spacing.touchTarget)) {
                    Text(stringResource(R.string.tracking_interval))
                }
                TextButton(onClick = { uri.openUri(listing.url) }, modifier = Modifier.heightIn(min = Spacing.touchTarget)) {
                    Text(stringResource(R.string.tracking_open))
                }
                TextButton(onClick = { actions.onStop(listing) }, modifier = Modifier.heightIn(min = Spacing.touchTarget)) {
                    Text(stringResource(R.string.tracking_stop), color = MaterialTheme.colorScheme.error)
                }
            }
        }
    }
}

/** RF-TRK-02 (T-224, decisión T100): the store's interval, then 2 h, 4 h, 12 h and a day. */
internal val INTERVAL_OPTIONS: List<Long?> = listOf(null, 120L, 240L, 720L, 1440L)

/** How often the home agent checks [listing]; picking an option saves it. */
@Composable
fun IntervalDialog(
    listing: TrackedListing,
    onPick: (minutes: Long?) -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.tracking_interval_title)) },
        text = {
            Column(Modifier.selectableGroup()) {
                INTERVAL_OPTIONS.forEach { minutes ->
                    val chosen = listing.intervalMin == minutes
                    val label = minutes?.let { span(it) } ?: stringResource(R.string.tracking_interval_store, span(listing.storeIntervalMin))
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .heightIn(min = Spacing.touchTarget)
                            .selectable(selected = chosen, role = Role.RadioButton, onClick = { onPick(minutes) }),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        RadioButton(selected = chosen, onClick = null)
                        Text(label, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(start = Spacing.md))
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.tracking_cancel)) } },
    )
}

@Composable
private fun span(minutes: Long): String =
    if (minutes % 60 == 0L) stringResource(R.string.tracking_hours, (minutes / 60).toInt()) else stringResource(R.string.tracking_minutes, minutes.toInt())
