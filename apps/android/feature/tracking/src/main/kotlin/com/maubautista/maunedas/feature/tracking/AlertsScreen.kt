package com.maubautista.maunedas.feature.tracking

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.core.content.ContextCompat
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.maubautista.maunedas.core.data.AlertEventItem
import com.maubautista.maunedas.core.data.AlertRuleItem
import com.maubautista.maunedas.core.data.AlertScope
import com.maubautista.maunedas.core.data.AlertType
import com.maubautista.maunedas.core.designsystem.Spacing
import com.maubautista.maunedas.core.designsystem.component.MoneyField
import com.maubautista.maunedas.core.model.Money
import com.maubautista.maunedas.core.ui.Dates
import com.maubautista.maunedas.core.designsystem.R as DesignR

data class AlertsActions(
    val onBack: (() -> Unit)? = null,
    val onNew: () -> Unit = {},
    val onOpenProduct: (productId: String) -> Unit = {},
    val onEdit: (AlertRuleItem) -> Unit = {},
    val onToggle: (AlertRuleItem) -> Unit = {},
    val onRemove: (AlertRuleItem) -> Unit = {},
)

/** S-22 and S-23 inside Catálogo, or for one variant from its product page ([onBack] shows a back arrow). */
@Composable
fun AlertsRoute(
    onOpenProduct: (productId: String) -> Unit,
    onBack: (() -> Unit)? = null,
    viewModel: AlertsViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val form by viewModel.form.collectAsStateWithLifecycle()
    val confirm by viewModel.confirmRemove.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val askNotifications = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
    LaunchedEffect(viewModel) {
        viewModel.firstRuleSaved.collect {
            val needed = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            if (needed && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
        }
    }
    AlertsScreen(
        state = state,
        now = viewModel.now(),
        actions =
            AlertsActions(
                onBack = onBack,
                onNew = viewModel::newRule,
                onOpenProduct = onOpenProduct,
                onEdit = viewModel::edit,
                onToggle = viewModel::toggle,
                onRemove = viewModel::askRemove,
            ),
    )
    form?.let { f ->
        RuleEditorSheet(
            form = f,
            actions =
                RuleEditorActions(
                    onDismiss = viewModel::closeForm,
                    onChange = viewModel::onForm,
                    onQuery = viewModel::onQuery,
                    onChoose = viewModel::chooseVariant,
                    onSave = viewModel::save,
                ),
        )
    }
    confirm?.let { rule ->
        AlertDialog(
            onDismissRequest = viewModel::dismissRemove,
            text = { Text(stringResource(R.string.alerts_remove_confirm, rule.name)) },
            confirmButton = { TextButton(onClick = viewModel::remove) { Text(stringResource(R.string.alerts_remove), color = MaterialTheme.colorScheme.error) } },
            dismissButton = { TextButton(onClick = viewModel::dismissRemove) { Text(stringResource(R.string.tracking_cancel)) } },
        )
    }
}

@Composable
fun AlertsScreen(
    state: AlertsState,
    now: Long,
    actions: AlertsActions,
    modifier: Modifier = Modifier,
) {
    LazyColumn(modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        item {
            Column(Modifier.padding(horizontal = Spacing.lg, vertical = Spacing.sm), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    actions.onBack?.let { back ->
                        IconButton(onClick = back) { Icon(painterResource(DesignR.drawable.ic_arrow_back), contentDescription = stringResource(R.string.tracking_back)) }
                    }
                    Text(stringResource(R.string.alerts_title), style = MaterialTheme.typography.titleLarge, modifier = Modifier.semantics { heading() })
                }
                state.variantName?.let { Text(stringResource(R.string.tracking_only, it), style = MaterialTheme.typography.bodyMedium) }
                Text(stringResource(R.string.alerts_note), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Button(onClick = actions.onNew, modifier = Modifier.heightIn(min = Spacing.touchTarget)) { Text(stringResource(R.string.alerts_new)) }
            }
        }
        item { SectionTitle(R.string.alerts_mine) }
        if (!state.loading && state.rules.isEmpty()) item { Hint(R.string.alerts_none) }
        items(state.rules, key = { "rule:${it.id}" }) { RuleCard(it, actions) }
        item { SectionTitle(R.string.alerts_history) }
        if (!state.loading && state.events.isEmpty()) item { Hint(R.string.alerts_history_none) }
        items(state.events, key = { "event:${it.id}" }) { EventCard(it, now, actions) }
        item { Column(Modifier.heightIn(min = Spacing.xl)) {} }
    }
}

@Composable
private fun SectionTitle(label: Int) {
    Text(stringResource(label), style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(horizontal = Spacing.lg).semantics { heading() })
}

@Composable
private fun Hint(label: Int) {
    Text(stringResource(label), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = Spacing.lg))
}

/** "Si baja a $25.00 o menos", as the web says it (T-223). */
@Composable
fun ruleText(rule: AlertRuleItem): String =
    when (rule.type) {
        AlertType.BELOW_PRICE -> stringResource(R.string.alerts_rule_below, Money.format(rule.thresholdCents ?: 0))
        AlertType.DROP_PCT -> stringResource(R.string.alerts_rule_drop, rule.thresholdPct?.let { if (it % 1.0 == 0.0) it.toLong().toString() else it.toString() } ?: "0")
        AlertType.NEW_LOW ->
            stringResource(
                when (rule.scope) {
                    AlertScope.VARIANT_ALL -> R.string.alerts_rule_low_all
                    AlertScope.LISTING -> R.string.alerts_rule_low_listing
                    AlertScope.VARIANT_WEB -> R.string.alerts_rule_low_web
                },
            )
        AlertType.PROMO -> stringResource(R.string.alerts_rule_promo)
        AlertType.BACK_IN_STOCK -> stringResource(R.string.alerts_rule_stock)
    }

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun RuleCard(
    rule: AlertRuleItem,
    actions: AlertsActions,
) {
    Card(Modifier.fillMaxWidth().padding(horizontal = Spacing.lg)) {
        Column(Modifier.padding(Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Text(rule.name, style = MaterialTheme.typography.titleSmall, modifier = Modifier.clickable { actions.onOpenProduct(rule.productId) })
            Text(ruleText(rule), style = MaterialTheme.typography.bodyMedium)
            val meta =
                listOfNotNull(
                    rule.storeName?.let { stringResource(R.string.alerts_only_store, it) } ?: stringResource(R.string.alerts_any_store),
                    if (rule.cooldownHours > 0) stringResource(R.string.alerts_silence, rule.cooldownHours.toInt()) else null,
                    if (!rule.active) stringResource(R.string.alerts_paused) else null,
                )
            Text(meta.joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                TextButton(onClick = { actions.onEdit(rule) }, modifier = Modifier.heightIn(min = Spacing.touchTarget)) { Text(stringResource(R.string.alerts_edit)) }
                TextButton(onClick = { actions.onToggle(rule) }, modifier = Modifier.heightIn(min = Spacing.touchTarget)) {
                    Text(stringResource(if (rule.active) R.string.alerts_pause else R.string.alerts_activate))
                }
                TextButton(onClick = { actions.onRemove(rule) }, modifier = Modifier.heightIn(min = Spacing.touchTarget)) {
                    Text(stringResource(R.string.alerts_remove), color = MaterialTheme.colorScheme.error)
                }
            }
        }
    }
}

private val DELIVERY =
    mapOf(
        "sent" to R.string.alerts_delivery_sent,
        "partial" to R.string.alerts_delivery_partial,
        "failed" to R.string.alerts_delivery_failed,
        "no_devices" to R.string.alerts_delivery_no_devices,
    )

@Composable
private fun EventCard(
    event: AlertEventItem,
    now: Long,
    actions: AlertsActions,
) {
    Card(Modifier.fillMaxWidth().padding(horizontal = Spacing.lg)) {
        Column(Modifier.padding(Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Text(event.title, style = MaterialTheme.typography.titleSmall)
            Text(event.body, style = MaterialTheme.typography.bodyMedium)
            val delivery = DELIVERY[event.deliveryStatus]?.let { stringResource(it) }
            Text(
                listOfNotNull(Dates.agoTime(event.firedAt, now), delivery).joinToString(" · "),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            event.productId?.let { product ->
                TextButton(onClick = { actions.onOpenProduct(product) }, modifier = Modifier.heightIn(min = Spacing.touchTarget)) {
                    Text(stringResource(R.string.alerts_open_product))
                }
            }
        }
    }
}

data class RuleEditorActions(
    val onDismiss: () -> Unit = {},
    val onChange: ((RuleFormState) -> RuleFormState) -> Unit = {},
    val onQuery: (String) -> Unit = {},
    val onChoose: (com.maubautista.maunedas.core.data.VariantOption) -> Unit = {},
    val onSave: () -> Unit = {},
)

private val TYPES =
    listOf(
        AlertType.BELOW_PRICE to R.string.alerts_type_below,
        AlertType.DROP_PCT to R.string.alerts_type_drop,
        AlertType.NEW_LOW to R.string.alerts_type_low,
        AlertType.PROMO to R.string.alerts_type_promo,
        AlertType.BACK_IN_STOCK to R.string.alerts_type_stock,
    )

private val SCOPES =
    listOf(
        AlertScope.VARIANT_WEB to R.string.alerts_scope_web,
        AlertScope.VARIANT_ALL to R.string.alerts_scope_all,
        AlertScope.LISTING to R.string.alerts_scope_listing,
    )

/** S-22's editor in a sheet. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RuleEditorSheet(
    form: RuleFormState,
    actions: RuleEditorActions,
) {
    ModalBottomSheet(onDismissRequest = actions.onDismiss) {
        RuleEditor(form, actions)
    }
}

/** The editor's fields; separate from the sheet so tests can show it. */
@Composable
fun RuleEditor(
    form: RuleFormState,
    actions: RuleEditorActions,
) {
    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Text(stringResource(if (form.id == null) R.string.alerts_editor_new else R.string.alerts_editor_edit), style = MaterialTheme.typography.titleLarge)
        Text(stringResource(R.string.alerts_editor_variant), style = MaterialTheme.typography.titleSmall)
        VariantSearch(
            chosen = form.variant,
            query = form.query,
            results = form.results,
            searched = form.searched,
            onQuery = actions.onQuery,
            onChoose = actions.onChoose,
            onChange = if (form.variantLocked) null else ({ actions.onChange { it.copy(variant = null, listingId = null) } }),
        )
        Text(stringResource(R.string.alerts_editor_when), style = MaterialTheme.typography.titleSmall)
        TYPES.forEach { (type, label) -> Choice(stringResource(label), form.type == type) { actions.onChange { it.copy(type = type) } } }
        when (form.type) {
            AlertType.BELOW_PRICE ->
                MoneyField(cents = form.priceCents, onCentsChange = { c -> actions.onChange { it.copy(priceCents = c) } }, label = stringResource(R.string.alerts_editor_price), modifier = Modifier.fillMaxWidth())
            AlertType.DROP_PCT ->
                OutlinedTextField(
                    value = form.pct,
                    onValueChange = { v -> actions.onChange { it.copy(pct = v) } },
                    label = { Text(stringResource(R.string.alerts_editor_pct)) },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            AlertType.NEW_LOW -> {
                Text(stringResource(R.string.alerts_editor_compare), style = MaterialTheme.typography.titleSmall)
                SCOPES.forEach { (scope, label) -> Choice(stringResource(label), form.scope == scope) { actions.onChange { it.copy(scope = scope) } } }
            }
            else -> Unit
        }
        if (form.variant != null) {
            Text(stringResource(R.string.alerts_editor_store), style = MaterialTheme.typography.titleSmall)
            Choice(stringResource(R.string.alerts_any_store), form.listingId == null) { actions.onChange { it.copy(listingId = null) } }
            form.stores.forEach { (id, store) -> Choice(stringResource(R.string.alerts_only_store, store), form.listingId == id) { actions.onChange { it.copy(listingId = id) } } }
        }
        OutlinedTextField(
            value = form.cooldown,
            onValueChange = { v -> actions.onChange { it.copy(cooldown = v) } },
            label = { Text(stringResource(R.string.alerts_editor_cooldown)) },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(R.string.alerts_editor_active))
            Switch(checked = form.active, onCheckedChange = { on -> actions.onChange { it.copy(active = on) } })
        }
        form.problem?.let { Text(stringResource(it), color = MaterialTheme.colorScheme.error) }
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            TextButton(onClick = actions.onDismiss, modifier = Modifier.heightIn(min = Spacing.touchTarget)) { Text(stringResource(R.string.tracking_cancel)) }
            Button(onClick = actions.onSave, enabled = !form.saving, modifier = Modifier.heightIn(min = Spacing.touchTarget)) { Text(stringResource(R.string.alerts_editor_save)) }
        }
    }
}

@Composable
private fun Choice(
    label: String,
    selected: Boolean,
    onSelect: () -> Unit,
) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = Spacing.touchTarget).selectable(selected = selected, onClick = onSelect, role = Role.RadioButton),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        RadioButton(selected = selected, onClick = null)
        Text(label)
    }
}
