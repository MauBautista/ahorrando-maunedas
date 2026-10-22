package com.maubautista.maunedas.feature.home

import androidx.annotation.DrawableRes
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Card
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.maubautista.maunedas.core.data.PurchaseSummary
import com.maubautista.maunedas.core.designsystem.Spacing
import com.maubautista.maunedas.core.model.Money
import com.maubautista.maunedas.core.ui.Dates
import com.maubautista.maunedas.core.ui.clock24h
import com.maubautista.maunedas.core.designsystem.R as DesignR

/** Where each S-02 action leads; the app wires them to the screens that exist. */
data class HomeActions(
    val newPurchase: () -> Unit = {},
    val receiptPhoto: () -> Unit = {},
    val shelfPrice: () -> Unit = {},
    val scan: () -> Unit = {},
    val openPurchase: (String) -> Unit = {},
    val openDrafts: () -> Unit = {},
    val openRejected: () -> Unit = {},
)

@Composable
fun HomeRoute(
    actions: HomeActions,
    viewModel: HomeViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    HomeScreen(state, actions)
}

/** S-02 (05 §5): four big actions, the month's spending, the last five purchases and what needs attention. */
@Composable
fun HomeScreen(
    state: HomeUiState,
    actions: HomeActions,
) {
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        Text(
            stringResource(R.string.home_hello, state.displayName),
            style = MaterialTheme.typography.headlineSmall,
            modifier = Modifier.semantics { heading() },
        )
        if (state.pending > 0) {
            // Discreet: it only says that something is still going up (05 §5).
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Icon(painterResource(DesignR.drawable.ic_cloud_upload), contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(
                    pluralStringResource(R.plurals.home_pending, state.pending, state.pending),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        if (state.openDrafts > 0) {
            Notice(
                text = pluralStringResource(R.plurals.home_drafts, state.openDrafts, state.openDrafts),
                icon = DesignR.drawable.ic_edit_note,
                container = MaterialTheme.colorScheme.secondaryContainer,
                content = MaterialTheme.colorScheme.onSecondaryContainer,
                onClick = actions.openDrafts,
            )
        }
        if (state.rejected > 0) {
            Notice(
                text = pluralStringResource(R.plurals.home_rejected, state.rejected, state.rejected),
                icon = DesignR.drawable.ic_sync_problem,
                container = MaterialTheme.colorScheme.errorContainer,
                content = MaterialTheme.colorScheme.onErrorContainer,
                onClick = actions.openRejected,
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            BigAction(R.string.home_new_purchase, DesignR.drawable.ic_add_shopping_cart, actions.newPurchase, Modifier.weight(1f))
            BigAction(R.string.home_receipt_photo, DesignR.drawable.ic_document_scanner, actions.receiptPhoto, Modifier.weight(1f))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            BigAction(R.string.home_shelf_price, DesignR.drawable.ic_sell, actions.shelfPrice, Modifier.weight(1f))
            BigAction(R.string.home_scan, DesignR.drawable.ic_barcode_scanner, actions.scan, Modifier.weight(1f))
        }
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(Spacing.lg).semantics(mergeDescendants = true) {}) {
                Text(stringResource(R.string.home_month_spent, Dates.monthName(state.month)), style = MaterialTheme.typography.titleMedium)
                Text(Money.format(state.monthSpentCents), style = MaterialTheme.typography.headlineMedium)
            }
        }
        Text(stringResource(R.string.home_recent), style = MaterialTheme.typography.titleMedium, modifier = Modifier.semantics { heading() })
        if (state.loaded && state.recent.isEmpty()) {
            Text(stringResource(R.string.home_no_purchases), style = MaterialTheme.typography.bodyLarge)
        }
        Column {
            state.recent.forEachIndexed { i, purchase ->
                if (i > 0) HorizontalDivider()
                RecentPurchase(purchase, state.now) { actions.openPurchase(purchase.id) }
            }
        }
    }
}

@Composable
private fun BigAction(
    label: Int,
    @DrawableRes icon: Int,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    FilledTonalButton(onClick = onClick, modifier = modifier.heightIn(min = 96.dp), shape = MaterialTheme.shapes.large) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Icon(painterResource(icon), contentDescription = null)
            Text(stringResource(label), textAlign = TextAlign.Center)
        }
    }
}

@Composable
private fun Notice(
    text: String,
    @DrawableRes icon: Int,
    container: Color,
    content: Color,
    onClick: () -> Unit,
) {
    Surface(
        color = container,
        contentColor = content,
        shape = MaterialTheme.shapes.medium,
        modifier = Modifier.fillMaxWidth().heightIn(min = Spacing.touchTarget).clickable(onClick = onClick),
    ) {
        Row(Modifier.padding(Spacing.md), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            Icon(painterResource(icon), contentDescription = null)
            Text(text, style = MaterialTheme.typography.bodyLarge)
        }
    }
}

@Composable
private fun RecentPurchase(
    purchase: PurchaseSummary,
    now: Long,
    onClick: () -> Unit,
) {
    val store = purchase.storeName ?: stringResource(R.string.home_unknown_store)
    val day = Dates.day(purchase.purchasedAt, now, clock24h())
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = Spacing.touchTarget)
            .clickable(onClick = onClick)
            .padding(vertical = Spacing.sm)
            .semantics(mergeDescendants = true) {},
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Column(Modifier.weight(1f)) {
            Text(listOfNotNull(store, purchase.branchName).joinToString(" · "), style = MaterialTheme.typography.bodyLarge)
            Text(
                "$day · ${pluralStringResource(R.plurals.home_lines, purchase.lineCount, purchase.lineCount)}",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Column(horizontalAlignment = Alignment.End) {
            Text(Money.format(purchase.totalCents), style = MaterialTheme.typography.bodyLarge)
            if (purchase.draft) {
                Surface(color = MaterialTheme.colorScheme.secondaryContainer, shape = MaterialTheme.shapes.small) {
                    Text(
                        stringResource(R.string.home_draft),
                        style = MaterialTheme.typography.labelMedium,
                        modifier = Modifier.padding(horizontal = Spacing.sm, vertical = Spacing.xs),
                    )
                }
            }
        }
    }
}
