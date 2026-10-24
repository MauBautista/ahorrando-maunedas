package com.maubautista.maunedas.feature.purchases

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Surface
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimeInput
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.maubautista.maunedas.core.data.BranchChoice
import com.maubautista.maunedas.core.data.PurchaseLine
import com.maubautista.maunedas.core.data.StoreChoice
import com.maubautista.maunedas.core.designsystem.Spacing
import com.maubautista.maunedas.core.designsystem.component.MoneyField
import com.maubautista.maunedas.core.designsystem.component.label
import com.maubautista.maunedas.core.model.HouseholdTime
import com.maubautista.maunedas.core.model.Money
import com.maubautista.maunedas.core.ui.BranchSheet
import com.maubautista.maunedas.core.ui.Dates
import com.maubautista.maunedas.core.ui.PlaceOption
import com.maubautista.maunedas.core.ui.StoreSheet
import com.maubautista.maunedas.core.ui.label
import com.maubautista.maunedas.core.ui.clock24h
import java.time.Instant
import java.time.LocalTime
import java.time.ZoneOffset
import com.maubautista.maunedas.core.designsystem.R as DesignR
import com.maubautista.maunedas.core.ui.R as UiR

/** Everything the editor can ask for. */
data class EditorActions(
    val onBack: () -> Unit = {},
    val onStore: (StoreChoice) -> Unit = {},
    val onNewStore: (name: String, kind: String) -> Unit = { _, _ -> },
    val onBranch: (BranchChoice?) -> Unit = {},
    val onNewBranch: (name: String, city: String) -> Unit = { _, _ -> },
    val onDate: (java.time.LocalDate) -> Unit = {},
    val onTime: (LocalTime) -> Unit = {},
    val onNewLine: () -> Unit = {},
    val onEditLine: (Int) -> Unit = {},
    val onRemoveLine: (Int) -> Unit = {},
    val onUndoRemove: () -> Unit = {},
    val onNewDiscount: () -> Unit = {},
    val onEditDiscount: (Int) -> Unit = {},
    val onRemoveDiscount: (Int) -> Unit = {},
    val onTicketTotal: (Long?) -> Unit = {},
    val onSaveDraft: () -> Unit = {},
    val onConfirm: () -> Unit = {},
    val onConfirmAnyway: () -> Unit = {},
    val onDismissMismatch: () -> Unit = {},
    val onAskDelete: () -> Unit = {},
    val onDismissDelete: () -> Unit = {},
    val onDelete: () -> Unit = {},
)

@Composable
fun PurchaseEditorRoute(
    onDone: () -> Unit,
    viewModel: PurchaseEditorViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val stores by viewModel.stores.collectAsStateWithLifecycle()
    val branches by viewModel.branches.collectAsStateWithLifecycle()
    LaunchedEffect(viewModel) { viewModel.done.collect { onDone() } }
    // "Autoguardado al salir" (05 §5): Back saves first, and so does sending the app to the background.
    BackHandler(onBack = viewModel::leave)
    LifecycleEventEffect(Lifecycle.Event.ON_STOP) { viewModel.autosave() }
    if (state.loading) return
    var defaultCity by remember { mutableStateOf("Puebla") }
    LaunchedEffect(Unit) { defaultCity = viewModel.defaultCity() }
    PurchaseEditorScreen(
        state = state,
        stores = stores,
        branches = branches,
        defaultCity = defaultCity,
        now = viewModel.now(),
        actions =
            EditorActions(
                onBack = viewModel::leave,
                onStore = viewModel::chooseStore,
                onNewStore = viewModel::createStore,
                onBranch = viewModel::chooseBranch,
                onNewBranch = viewModel::createBranch,
                onDate = viewModel::setDate,
                onTime = viewModel::setTime,
                onNewLine = viewModel::newLine,
                onEditLine = viewModel::editLine,
                onRemoveLine = viewModel::removeLine,
                onUndoRemove = viewModel::undoRemove,
                onNewDiscount = viewModel::newDiscount,
                onEditDiscount = viewModel::editDiscount,
                onRemoveDiscount = viewModel::removeDiscount,
                onTicketTotal = viewModel::setTicketTotal,
                onSaveDraft = viewModel::saveDraft,
                onConfirm = viewModel::confirm,
                onConfirmAnyway = viewModel::confirmAnyway,
                onDismissMismatch = viewModel::dismissMismatch,
                onAskDelete = viewModel::askDelete,
                onDismissDelete = viewModel::dismissDelete,
                onDelete = viewModel::delete,
            ),
    )
    state.line?.let { form ->
        LineSheet(
            form = form,
            onChange = viewModel::onLine,
            onQuery = viewModel::onLineQuery,
            onSave = viewModel::saveLine,
            onDismiss = viewModel::closeLine,
        )
    }
    state.discount?.let { form ->
        val defaultDescription = stringResource(R.string.editor_default_discount)
        DiscountDialog(form, viewModel::onDiscount, { viewModel.saveDiscount(defaultDescription) }, viewModel::closeDiscount)
    }
}

private enum class Picker { STORE, BRANCH, DATE, TIME }

/**
 * S-04 (05 §5): store, branch, date and time; the lines; Σ lines, ticket discounts, computed and ticket totals with
 * the difference (RF-COM-06). The bar at the bottom keeps the total and the two buttons; the rest scrolls, so at
 * 200 % font nothing is hidden behind a fixed footer.
 */
@Composable
fun PurchaseEditorScreen(
    state: EditorState,
    stores: List<StoreChoice>,
    branches: List<BranchChoice>,
    defaultCity: String,
    now: Long,
    actions: EditorActions,
) {
    val draft = state.draft
    val totals = state.totals
    var picker by rememberSaveable { mutableStateOf<Picker?>(null) }
    val snackbar = remember { SnackbarHostState() }
    val removedMessage = state.removed?.let { stringResource(R.string.editor_line_removed, it.second.title()) }
    val undo = stringResource(R.string.editor_undo)
    LaunchedEffect(state.removed) {
        if (removedMessage != null && snackbar.showSnackbar(removedMessage, undo, duration = SnackbarDuration.Short) == SnackbarResult.ActionPerformed) actions.onUndoRemove()
    }
    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                item {
                    Column(Modifier.padding(horizontal = Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            IconButton(onClick = actions.onBack) { Icon(painterResource(DesignR.drawable.ic_arrow_back), contentDescription = stringResource(R.string.editor_back)) }
                            Text(
                                stringResource(if (state.isNew) R.string.editor_new_title else R.string.editor_title),
                                style = MaterialTheme.typography.headlineSmall,
                                modifier = Modifier.weight(1f).semantics { heading() },
                            )
                        }
                        HeaderButton(stores.firstOrNull { it.id == draft.storeId }?.name ?: stringResource(R.string.editor_store_pick)) { picker = Picker.STORE }
                        if (draft.storeId != null) {
                            HeaderButton(stringResource(R.string.editor_branch, branches.firstOrNull { it.id == draft.branchId }?.name ?: stringResource(UiR.string.ui_no_branch))) {
                                picker = Picker.BRANCH
                            }
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                            HeaderButton(stringResource(R.string.editor_date, Dates.shortDate(draft.purchasedAt, now)), Modifier.weight(1f)) { picker = Picker.DATE }
                            HeaderButton(stringResource(R.string.editor_time, Dates.time(draft.purchasedAt, clock24h())), Modifier.weight(1f)) { picker = Picker.TIME }
                        }
                        state.problem?.let { Text(stringResource(it), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyLarge) }
                        Text(stringResource(R.string.editor_lines), style = MaterialTheme.typography.titleMedium, modifier = Modifier.semantics { heading() })
                        if (draft.lines.isEmpty()) Text(stringResource(R.string.editor_no_lines), style = MaterialTheme.typography.bodyLarge)
                    }
                }
                itemsIndexed(draft.lines, key = { i, line -> line.id ?: "new:$i:${line.hashCode()}" }) { i, line ->
                    SwipeableLine(line, onOpen = { actions.onEditLine(i) }, onRemove = { actions.onRemoveLine(i) })
                }
                item {
                    Column(Modifier.padding(horizontal = Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                        OutlinedButton(onClick = actions.onNewLine, modifier = Modifier.fillMaxWidth().heightIn(min = Spacing.touchTarget)) { Text(stringResource(R.string.editor_add_line)) }
                        HorizontalDivider()
                        AmountRow(stringResource(R.string.editor_lines_sum), totals.linesCents)
                        Text(stringResource(R.string.editor_ticket_discounts), style = MaterialTheme.typography.titleSmall)
                        draft.ticketDiscounts.forEachIndexed { i, d ->
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(
                                    "${d.description}: −${Money.format(d.amountCents)}",
                                    style = MaterialTheme.typography.bodyLarge,
                                    modifier = Modifier.weight(1f).heightIn(min = Spacing.touchTarget).clickable { actions.onEditDiscount(i) }.padding(vertical = Spacing.sm),
                                )
                                IconButton(onClick = { actions.onRemoveDiscount(i) }) {
                                    Icon(painterResource(DesignR.drawable.ic_close), contentDescription = stringResource(R.string.editor_remove_discount, d.description))
                                }
                            }
                        }
                        TextButton(onClick = actions.onNewDiscount, modifier = Modifier.heightIn(min = Spacing.touchTarget)) { Text(stringResource(R.string.editor_add_discount)) }
                        AmountRow(stringResource(R.string.editor_computed_total), totals.computedCents, strong = true)
                        MoneyField(cents = draft.ticketTotalCents, onCentsChange = actions.onTicketTotal, label = stringResource(R.string.editor_ticket_total), modifier = Modifier.fillMaxWidth())
                        if (totals.mismatch) {
                            Text(
                                stringResource(R.string.editor_difference, Money.format(kotlin.math.abs(totals.differenceCents!!))),
                                color = MaterialTheme.colorScheme.error,
                                style = MaterialTheme.typography.titleMedium,
                            )
                        }
                        if (!state.isNew) {
                            TextButton(onClick = actions.onAskDelete, modifier = Modifier.fillMaxWidth().heightIn(min = Spacing.touchTarget)) {
                                Text(stringResource(R.string.editor_delete), color = MaterialTheme.colorScheme.error)
                            }
                        }
                    }
                }
            }
            Surface(tonalElevation = Spacing.xs) {
                Column(Modifier.fillMaxWidth().padding(Spacing.md), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    AmountRow(stringResource(R.string.editor_computed_total), totals.computedCents, strong = true)
                    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                        OutlinedButton(onClick = actions.onSaveDraft, enabled = !state.busy, modifier = Modifier.weight(1f).heightIn(min = Spacing.touchTarget)) {
                            Text(stringResource(if (draft.confirmed) R.string.editor_save else R.string.editor_save_draft))
                        }
                        Button(onClick = actions.onConfirm, enabled = !state.busy, modifier = Modifier.weight(1f).heightIn(min = Spacing.touchTarget)) {
                            Text(stringResource(R.string.editor_confirm))
                        }
                    }
                }
            }
        }
        SnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter).padding(bottom = Spacing.xxl))
    }
    when (picker) {
        Picker.STORE ->
            StoreSheet(
                stores.map { PlaceOption(it.id, it.name) },
                draft.storeId,
                onPick = { o -> actions.onStore(StoreChoice(o.id, o.name)); picker = null },
                onCreate = { n, k -> actions.onNewStore(n, k); picker = null },
                onDismiss = { picker = null },
            )
        Picker.BRANCH ->
            BranchSheet(
                branches.map { PlaceOption(it.id, it.name, it.city) },
                draft.branchId,
                defaultCity,
                onPick = { o -> actions.onBranch(o?.let { BranchChoice(it.id, it.name, it.detail) }); picker = null },
                onCreate = { n, c -> actions.onNewBranch(n, c); picker = null },
                onDismiss = { picker = null },
            )
        Picker.DATE -> DateDialog(draft.purchasedAt, onPick = { actions.onDate(it); picker = null }, onDismiss = { picker = null })
        Picker.TIME -> TimeDialog(draft.purchasedAt, onPick = { actions.onTime(it); picker = null }, onDismiss = { picker = null })
        null -> Unit
    }
    state.mismatchCents?.let { diff ->
        AlertDialog(
            onDismissRequest = actions.onDismissMismatch,
            text = { Text(stringResource(R.string.editor_mismatch, Money.format(kotlin.math.abs(diff)))) },
            confirmButton = { TextButton(onClick = actions.onConfirmAnyway) { Text(stringResource(R.string.editor_confirm_anyway)) } },
            dismissButton = { TextButton(onClick = actions.onDismissMismatch) { Text(stringResource(R.string.purchases_cancel)) } },
        )
    }
    if (state.confirmDelete) {
        AlertDialog(
            onDismissRequest = actions.onDismissDelete,
            text = { Text(stringResource(R.string.editor_delete_confirm)) },
            confirmButton = { TextButton(onClick = actions.onDelete) { Text(stringResource(R.string.editor_delete_yes), color = MaterialTheme.colorScheme.error) } },
            dismissButton = { TextButton(onClick = actions.onDismissDelete) { Text(stringResource(R.string.purchases_cancel)) } },
        )
    }
}

/** "Producto · Variante", or the ticket's text while unlinked. */
@Composable
private fun PurchaseLine.title(): String =
    variant?.let { "${it.productName} · ${it.label}" } ?: stringResource(R.string.editor_unlinked, rawText.orEmpty())

@Composable
private fun HeaderButton(
    text: String,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    OutlinedButton(onClick = onClick, modifier = modifier.fillMaxWidth().heightIn(min = Spacing.touchTarget)) { Text(text) }
}

@Composable
private fun AmountRow(
    label: String,
    cents: Long,
    strong: Boolean = false,
) {
    val style = if (strong) MaterialTheme.typography.titleMedium else MaterialTheme.typography.bodyLarge
    Row(Modifier.fillMaxWidth().semantics(mergeDescendants = true) {}, horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, style = style, modifier = Modifier.weight(1f))
        Text(Money.format(cents), style = style)
    }
}

/** A line of S-04; swiping it away (or its button) removes it, with "Deshacer". */
@Composable
private fun SwipeableLine(
    line: PurchaseLine,
    onOpen: () -> Unit,
    onRemove: () -> Unit,
) {
    val swipe = rememberSwipeToDismissBoxState()
    SwipeToDismissBox(
        state = swipe,
        backgroundContent = { Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.errorContainer)) },
        enableDismissFromStartToEnd = false,
        onDismiss = { if (it == SwipeToDismissBoxValue.EndToStart) onRemove() },
    ) {
        Surface {
            LineRow(line, onOpen, onRemove)
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun LineRow(
    line: PurchaseLine,
    onOpen: () -> Unit,
    onRemove: () -> Unit,
) {
    val unlinked = line.variant == null
    val a = line.amounts
    val title = line.title()
    Row(
        Modifier
            .fillMaxWidth()
            .background(if (unlinked) MaterialTheme.colorScheme.tertiaryContainer else MaterialTheme.colorScheme.surface)
            .clickable(onClick = onOpen)
            .padding(start = Spacing.lg, top = Spacing.sm, bottom = Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f).semantics(mergeDescendants = true) {}, verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Text(title, style = MaterialTheme.typography.bodyLarge)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Text(stringResource(R.string.editor_line_qty, quantityText(line), Money.format(line.unitPriceCents)), style = MaterialTheme.typography.bodyMedium)
                line.promotion?.let { promo ->
                    Surface(color = MaterialTheme.colorScheme.secondaryContainer, shape = MaterialTheme.shapes.small) {
                        Text(stringResource(promo.type.label()), style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(horizontal = Spacing.sm, vertical = Spacing.xs))
                    }
                }
            }
            Text(Money.format(a.finalCents), style = MaterialTheme.typography.titleMedium)
            val perUnit = line.perUnitCents()
            val unit = line.variant?.unit
            if (perUnit != null && unit != null) {
                Text(stringResource(DesignR.string.ds_per_unit, Money.format(perUnit), unit.label()), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        IconButton(onClick = onRemove) {
            Icon(painterResource(DesignR.drawable.ic_close), contentDescription = stringResource(R.string.editor_remove_line, title))
        }
    }
}

/** Whole pieces as "2"; weights with up to three decimals as "0.845". */
internal fun quantityText(line: PurchaseLine): String =
    if (line.quantity == kotlin.math.floor(line.quantity)) line.quantity.toLong().toString() else line.quantity.toBigDecimal().stripTrailingZeros().toPlainString()

@Composable
private fun DiscountDialog(
    form: DiscountForm,
    onChange: ((DiscountForm) -> DiscountForm) -> Unit,
    onSave: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.editor_discount_title)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                OutlinedTextField(
                    value = form.description,
                    onValueChange = { v -> onChange { it.copy(description = v.take(300)) } },
                    label = { Text(stringResource(R.string.editor_discount_description)) },
                    singleLine = true,
                )
                MoneyField(cents = form.amountCents, onCentsChange = { v -> onChange { it.copy(amountCents = v) } }, label = stringResource(R.string.editor_discount_amount))
            }
        },
        confirmButton = { TextButton(onClick = onSave, enabled = (form.amountCents ?: 0) > 0) { Text(stringResource(R.string.editor_save)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.purchases_cancel)) } },
    )
}

/** The purchase day; the picker speaks midnight UTC (as the list's date range). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DateDialog(
    at: Long,
    onPick: (java.time.LocalDate) -> Unit,
    onDismiss: () -> Unit,
) {
    val today = Instant.ofEpochMilli(at).atZone(HouseholdTime.ZONE).toLocalDate()
    val state = rememberDatePickerState(initialSelectedDateMillis = today.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli())
    DatePickerDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            TextButton(onClick = {
                state.selectedDateMillis?.let { onPick(Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate()) }
            }) { Text(stringResource(R.string.purchases_ok)) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.purchases_cancel)) } },
    ) { DatePicker(state = state) }
}

/** Typed hours and minutes: easier than a dial with large fonts. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TimeDialog(
    at: Long,
    onPick: (LocalTime) -> Unit,
    onDismiss: () -> Unit,
) {
    val time = Instant.ofEpochMilli(at).atZone(HouseholdTime.ZONE).toLocalTime()
    val state = rememberTimePickerState(initialHour = time.hour, initialMinute = time.minute, is24Hour = clock24h())
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.editor_time_title)) },
        text = { TimeInput(state = state) },
        confirmButton = { TextButton(onClick = { onPick(LocalTime.of(state.hour, state.minute)) }) { Text(stringResource(R.string.purchases_ok)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.purchases_cancel)) } },
    )
}
