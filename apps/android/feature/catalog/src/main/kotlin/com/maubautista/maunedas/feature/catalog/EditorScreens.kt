package com.maubautista.maunedas.feature.catalog

import androidx.annotation.StringRes
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.maubautista.maunedas.core.camera.ScanCodeSheet
import com.maubautista.maunedas.core.data.CategoryNode
import com.maubautista.maunedas.core.data.TagItem
import com.maubautista.maunedas.core.data.VariantSummary
import com.maubautista.maunedas.core.designsystem.Spacing
import com.maubautista.maunedas.core.designsystem.component.label
import com.maubautista.maunedas.core.model.DisplayUnit
import com.maubautista.maunedas.core.model.Measure
import com.maubautista.maunedas.core.pricing.ContentUnit
import com.maubautista.maunedas.core.designsystem.R as DesignR

@Composable
fun ProductEditorRoute(
    onDone: () -> Unit,
    onOpenVariant: (productId: String, variantId: String?) -> Unit,
    viewModel: ProductEditorViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val categories by viewModel.categories.collectAsStateWithLifecycle()
    val tags by viewModel.tags.collectAsStateWithLifecycle()
    val variants by viewModel.variants.collectAsStateWithLifecycle()
    val isAdmin by viewModel.isAdmin.collectAsStateWithLifecycle()
    LaunchedEffect(viewModel) { viewModel.done.collect { onDone() } }
    if (state.loading) return
    ProductEditorScreen(
        state = state,
        categories = categories,
        tags = tags,
        variants = variants,
        isAdmin = isAdmin,
        actions =
            ProductEditorActions(
                onBack = onDone,
                onProduct = viewModel::onProduct,
                onAddTag = viewModel::addTypedTag,
                onFirstVariant = viewModel::onFirstVariant,
                onAddCode = viewModel::addCode,
                onOpenVariant = { variantId -> state.product.id?.let { onOpenVariant(it, variantId) } },
                onSave = viewModel::save,
                onAskDelete = viewModel::askDelete,
                onDismissDelete = viewModel::dismissDelete,
                onDelete = viewModel::delete,
            ),
    )
}

data class ProductEditorActions(
    val onBack: () -> Unit = {},
    val onProduct: ((ProductForm) -> ProductForm) -> Unit = {},
    val onAddTag: () -> Unit = {},
    val onFirstVariant: ((VariantForm) -> VariantForm) -> Unit = {},
    val onAddCode: () -> Unit = {},
    val onOpenVariant: (variantId: String?) -> Unit = {},
    val onSave: () -> Unit = {},
    val onAskDelete: () -> Unit = {},
    val onDismissDelete: () -> Unit = {},
    val onDelete: () -> Unit = {},
)

/** S-09 (05 §5); a new product also gets its first variant (T56). Deleting is only offered to admins (RF-CAT-08). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ProductEditorScreen(
    state: ProductEditorState,
    categories: List<CategoryNode>,
    tags: List<TagItem>,
    variants: List<VariantSummary>,
    isAdmin: Boolean,
    actions: ProductEditorActions,
) {
    val form = state.product
    var pickCategory by rememberSaveable { mutableStateOf(false) }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        EditorHeader(if (state.isNew) R.string.editor_new_product else R.string.editor_edit_product, actions.onBack)
        OutlinedTextField(
            value = form.name,
            onValueChange = { v -> actions.onProduct { it.withName(v) } },
            label = { Text(stringResource(R.string.editor_name)) },
            isError = form.nameError != null,
            supportingText = form.nameError?.let { { Text(stringResource(it)) } },
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = form.brand,
            onValueChange = { v -> actions.onProduct { it.copy(brand = v) } },
            label = { Text(stringResource(R.string.editor_brand)) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        SectionTitle(R.string.editor_category)
        OutlinedButton(onClick = { pickCategory = true }, modifier = Modifier.fillMaxWidth().heightIn(min = Spacing.touchTarget)) {
            Text(categories.firstOrNull { it.id == form.categoryId }?.name ?: stringResource(R.string.editor_no_category))
        }
        SectionTitle(R.string.editor_tags)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            tags.forEach { tag ->
                FilterChip(selected = tag.id in form.tagIds, onClick = { actions.onProduct { it.toggleTag(tag.id) } }, label = { Text(tag.name) })
            }
            form.newTags.forEach { name ->
                FilterChip(selected = true, onClick = { actions.onProduct { it.withoutNewTag(name) } }, label = { Text(name) })
            }
        }
        InputWithButton(
            value = form.tagInput,
            onValueChange = { v -> actions.onProduct { it.copy(tagInput = v) } },
            label = R.string.editor_new_tag,
            onAdd = actions.onAddTag,
        )
        SectionTitle(R.string.editor_display_unit)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            DisplayUnit.entries.forEach { unit ->
                FilterChip(selected = unit == form.displayUnit, onClick = { actions.onProduct { it.withUnit(unit) } }, label = { Text(unit.label()) })
            }
        }
        OutlinedTextField(
            value = form.notes,
            onValueChange = { v -> actions.onProduct { it.copy(notes = v) } },
            label = { Text(stringResource(R.string.editor_notes)) },
            minLines = 2,
            modifier = Modifier.fillMaxWidth(),
        )
        val first = state.firstVariant
        if (first != null) {
            Text(stringResource(R.string.editor_first_variant), style = MaterialTheme.typography.titleLarge, modifier = Modifier.semantics { heading() })
            VariantFields(first, actions.onFirstVariant, actions.onAddCode)
        } else {
            Text(stringResource(R.string.editor_variants), style = MaterialTheme.typography.titleLarge, modifier = Modifier.semantics { heading() })
            variants.forEachIndexed { i, v ->
                if (i > 0) HorizontalDivider()
                Text(
                    v.label,
                    style = MaterialTheme.typography.bodyLarge,
                    modifier = Modifier.fillMaxWidth().heightIn(min = Spacing.touchTarget).clickable { actions.onOpenVariant(v.id) }.padding(vertical = Spacing.md),
                )
            }
            OutlinedButton(onClick = { actions.onOpenVariant(null) }, modifier = Modifier.fillMaxWidth().heightIn(min = Spacing.touchTarget)) {
                Text(stringResource(R.string.editor_add_variant))
            }
        }
        Button(onClick = actions.onSave, enabled = !state.busy, modifier = Modifier.fillMaxWidth().heightIn(min = Spacing.touchTarget)) {
            Text(stringResource(R.string.editor_save))
        }
        if (!state.isNew && isAdmin) DeleteButton(R.string.editor_delete_product, actions.onAskDelete)
    }
    if (pickCategory) {
        ChoiceSheet(
            allLabel = stringResource(R.string.editor_no_category),
            options = categories.map { Choice(it.id, it.name, it.depth) },
            selected = form.categoryId,
            emptyLabel = null,
            onPick = { id -> actions.onProduct { it.copy(categoryId = id) }; pickCategory = false },
            onDismiss = { pickCategory = false },
        )
    }
    if (state.confirmDelete) {
        ConfirmDelete(stringResource(R.string.editor_delete_product_confirm, form.name), actions.onDelete, actions.onDismissDelete)
    }
}

@Composable
fun VariantEditorRoute(
    onDone: () -> Unit,
    viewModel: VariantEditorViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val isAdmin by viewModel.isAdmin.collectAsStateWithLifecycle()
    LaunchedEffect(viewModel) { viewModel.done.collect { onDone() } }
    if (state.loading) return
    VariantEditorScreen(
        state = state,
        isAdmin = isAdmin,
        actions =
            VariantEditorActions(
                onBack = onDone,
                onVariant = viewModel::onVariant,
                onAddCode = viewModel::addCode,
                onSave = viewModel::save,
                onAskDelete = viewModel::askDelete,
                onDismissDelete = viewModel::dismissDelete,
                onDelete = viewModel::delete,
                onAskMerge = viewModel::askMerge,
                onDismissMerge = viewModel::dismissMerge,
                onMerge = viewModel::mergeIntoCodeOwner,
            ),
    )
}

data class VariantEditorActions(
    val onBack: () -> Unit = {},
    val onVariant: ((VariantForm) -> VariantForm) -> Unit = {},
    val onAddCode: () -> Unit = {},
    val onSave: () -> Unit = {},
    val onAskDelete: () -> Unit = {},
    val onDismissDelete: () -> Unit = {},
    val onDelete: () -> Unit = {},
    val onAskMerge: () -> Unit = {},
    val onDismissMerge: () -> Unit = {},
    val onMerge: () -> Unit = {},
)

/**
 * S-10 (05 §5). Deleting is only offered to admins (RF-CAT-08), and so is merging this variant into the one that
 * already has a typed code (RF-CAT-03).
 */
@Composable
fun VariantEditorScreen(
    state: VariantEditorState,
    isAdmin: Boolean,
    actions: VariantEditorActions,
) {
    val isNew = state.variant.id == null
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        EditorHeader(if (isNew) R.string.editor_new_variant else R.string.editor_edit_variant, actions.onBack)
        VariantFields(state.variant, actions.onVariant, actions.onAddCode)
        val owner = state.variant.codeOwner
        if (!isNew && isAdmin && owner != null && state.variant.codeOwnerId != null) {
            OutlinedButton(onClick = actions.onAskMerge, enabled = !state.busy, modifier = Modifier.fillMaxWidth().heightIn(min = Spacing.touchTarget)) {
                Text(stringResource(R.string.merge_code_owner, owner))
            }
        }
        Button(onClick = actions.onSave, enabled = !state.busy, modifier = Modifier.fillMaxWidth().heightIn(min = Spacing.touchTarget)) {
            Text(stringResource(R.string.editor_save))
        }
        if (!isNew && isAdmin) DeleteButton(R.string.editor_delete_variant, actions.onAskDelete)
    }
    if (state.confirmDelete) {
        ConfirmDelete(stringResource(R.string.editor_delete_variant_confirm, state.variant.label), actions.onDelete, actions.onDismissDelete)
    }
    if (state.confirmMerge) {
        AlertDialog(
            onDismissRequest = actions.onDismissMerge,
            text = { Text(stringResource(R.string.merge_variant_confirm, state.variant.label, state.variant.codeOwner.orEmpty())) },
            confirmButton = { TextButton(onClick = actions.onMerge) { Text(stringResource(R.string.merge_confirm), color = MaterialTheme.colorScheme.error) } },
            dismissButton = { TextButton(onClick = actions.onDismissMerge) { Text(stringResource(R.string.editor_cancel)) } },
        )
    }
    state.message?.let { MergeMessage(it, actions.onDismissMerge) }
}

/** Measure, "a granel", the content assistant, the label and the barcodes (S-10). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun VariantFields(
    form: VariantForm,
    onChange: ((VariantForm) -> VariantForm) -> Unit,
    onAddCode: () -> Unit,
) {
    SectionTitle(R.string.editor_measure)
    FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        listOf(Measure.MASS to R.string.editor_mass, Measure.VOLUME to R.string.editor_volume, Measure.COUNT to R.string.editor_count).forEach { (m, label) ->
            FilterChip(selected = form.measure == m, onClick = { onChange { it.withMeasure(m) } }, label = { Text(stringResource(label)) })
        }
    }
    if (form.measure == Measure.MASS) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = Spacing.touchTarget).toggleable(form.bulk, role = Role.Switch) { b -> onChange { it.withBulk(b) } },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            Switch(checked = form.bulk, onCheckedChange = null)
            Text(stringResource(R.string.editor_bulk), style = MaterialTheme.typography.bodyLarge)
        }
    }
    if (!form.bulk) {
        SectionTitle(R.string.editor_content)
        NumberField(form.pack, { v -> onChange { it.withPack(v) } }, R.string.editor_pack, form.packError, KeyboardType.Number)
        NumberField(form.amount, { v -> onChange { it.withAmount(v) } }, R.string.editor_amount, form.amountError, KeyboardType.Decimal)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            ContentUnit.of(form.measure).forEach { unit ->
                FilterChip(selected = form.unit == unit, onClick = { onChange { it.withUnit(unit) } }, label = { Text(unit.label) })
            }
        }
    }
    OutlinedTextField(
        value = form.label,
        onValueChange = { v -> onChange { it.withLabel(v) } },
        label = { Text(stringResource(R.string.editor_label)) },
        isError = form.labelError != null,
        supportingText = { Text(stringResource(form.labelError ?: R.string.editor_label_hint)) },
        singleLine = true,
        modifier = Modifier.fillMaxWidth(),
    )
    SectionTitle(R.string.editor_codes)
    if (form.codes.isEmpty()) Text(stringResource(R.string.editor_no_codes), style = MaterialTheme.typography.bodyMedium)
    form.codes.forEach { code ->
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(code, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
            IconButton(onClick = { onChange { it.withoutCode(code) } }) {
                Icon(painterResource(DesignR.drawable.ic_close), contentDescription = stringResource(R.string.editor_remove_code, code))
            }
        }
    }
    val codeError = form.codeError?.let { if (form.codeOwner != null) stringResource(it, form.codeOwner) else stringResource(it) }
    var scanning by rememberSaveable { mutableStateOf(false) }
    // S-10 "Escanear código": the read goes through the same checks as a typed one (T56).
    OutlinedButton(onClick = { scanning = true }, modifier = Modifier.fillMaxWidth().heightIn(min = Spacing.touchTarget)) { Text(stringResource(R.string.editor_scan_code)) }
    if (scanning) {
        ScanCodeSheet(
            onCode = { code ->
                scanning = false
                onChange { it.withCodeInput(code, source = "scan") }
                onAddCode()
            },
            onDismiss = { scanning = false },
        )
    }
    InputWithButton(
        value = form.codeInput,
        onValueChange = { v -> onChange { it.withCodeInput(v) } },
        label = R.string.editor_new_code,
        onAdd = onAddCode,
        error = codeError,
        keyboardType = KeyboardType.Number,
    )
}

@Composable
private fun EditorHeader(
    @StringRes title: Int,
    onBack: () -> Unit,
) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        IconButton(onClick = onBack) { Icon(painterResource(DesignR.drawable.ic_arrow_back), contentDescription = stringResource(R.string.editor_back)) }
        Text(stringResource(title), style = MaterialTheme.typography.headlineSmall, modifier = Modifier.semantics { heading() })
    }
}

@Composable
private fun SectionTitle(
    @StringRes text: Int,
) {
    Text(stringResource(text), style = MaterialTheme.typography.titleMedium, modifier = Modifier.semantics { heading() })
}

@Composable
private fun NumberField(
    value: String,
    onValueChange: (String) -> Unit,
    @StringRes label: Int,
    @StringRes error: Int?,
    keyboardType: KeyboardType,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        label = { Text(stringResource(label)) },
        isError = error != null,
        supportingText = error?.let { { Text(stringResource(it)) } },
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = keyboardType, imeAction = ImeAction.Next),
        modifier = Modifier.fillMaxWidth(),
    )
}

/** A field with its "Agregar" button below, so both fit at large font sizes. */
@Composable
private fun InputWithButton(
    value: String,
    onValueChange: (String) -> Unit,
    @StringRes label: Int,
    onAdd: () -> Unit,
    error: String? = null,
    keyboardType: KeyboardType = KeyboardType.Text,
) {
    Column {
        OutlinedTextField(
            value = value,
            onValueChange = onValueChange,
            label = { Text(stringResource(label)) },
            isError = error != null,
            supportingText = error?.let { { Text(it) } },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = keyboardType, imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { onAdd() }),
            modifier = Modifier.fillMaxWidth(),
        )
        TextButton(onClick = onAdd, enabled = value.isNotBlank(), modifier = Modifier.heightIn(min = Spacing.touchTarget)) {
            Text(stringResource(R.string.editor_add))
        }
    }
}

@Composable
private fun DeleteButton(
    @StringRes label: Int,
    onClick: () -> Unit,
) {
    TextButton(onClick = onClick, modifier = Modifier.fillMaxWidth().heightIn(min = Spacing.touchTarget)) {
        Text(stringResource(label), color = MaterialTheme.colorScheme.error)
    }
}

@Composable
private fun ConfirmDelete(
    text: String,
    onDelete: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        text = { Text(text) },
        confirmButton = { TextButton(onClick = onDelete) { Text(stringResource(R.string.editor_delete), color = MaterialTheme.colorScheme.error) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.editor_cancel)) } },
    )
}
