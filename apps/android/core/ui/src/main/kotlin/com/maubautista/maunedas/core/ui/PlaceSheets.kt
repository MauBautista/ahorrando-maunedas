package com.maubautista.maunedas.core.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import com.maubautista.maunedas.core.designsystem.Spacing
import com.maubautista.maunedas.core.pricing.SearchKey

/** A store or branch to choose; [detail] is a branch's city. */
data class PlaceOption(
    val id: String,
    val name: String,
    val detail: String? = null,
)

/** S-14 (05 §5): stores by recent use, a search, and "Nueva tienda" (purchase editor, shelf price). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StoreSheet(
    stores: List<PlaceOption>,
    selected: String?,
    onPick: (PlaceOption) -> Unit,
    onCreate: (name: String, kind: String) -> Unit,
    onDismiss: () -> Unit,
) {
    var query by rememberSaveable { mutableStateOf("") }
    var creating by rememberSaveable { mutableStateOf(false) }
    var kind by rememberSaveable { mutableStateOf("physical") }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = Spacing.lg).padding(bottom = Spacing.xl), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            OutlinedTextField(value = query, onValueChange = { query = it }, label = { Text(stringResource(R.string.ui_stores_search)) }, singleLine = true, modifier = Modifier.fillMaxWidth())
            val key = SearchKey.of(query)
            stores.filter { key.isEmpty() || SearchKey.of(it.name).contains(key) }.forEach { store ->
                ChoiceRow(store.name, store.id == selected) { onPick(store) }
            }
            HorizontalDivider()
            if (!creating) {
                TextButton(onClick = { creating = true }, modifier = Modifier.heightIn(min = Spacing.touchTarget)) { Text(stringResource(R.string.ui_stores_new)) }
            } else {
                // The search text is usually the name of the missing store.
                var name by rememberSaveable { mutableStateOf(query.trim()) }
                OutlinedTextField(value = name, onValueChange = { name = it.take(200) }, label = { Text(stringResource(R.string.ui_stores_name)) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    listOf("physical" to R.string.ui_stores_physical, "online" to R.string.ui_stores_online, "both" to R.string.ui_stores_both).forEach { (k, label) ->
                        FilterChip(selected = kind == k, onClick = { kind = k }, label = { Text(stringResource(label)) })
                    }
                }
                Button(onClick = { onCreate(name, kind) }, enabled = name.isNotBlank(), modifier = Modifier.fillMaxWidth().heightIn(min = Spacing.touchTarget)) { Text(stringResource(R.string.ui_stores_add)) }
            }
        }
    }
}

/** The store's branches, "Sin sucursal" and "Nueva sucursal" (city defaults to the last one used). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BranchSheet(
    branches: List<PlaceOption>,
    selected: String?,
    defaultCity: String,
    onPick: (PlaceOption?) -> Unit,
    onCreate: (name: String, city: String) -> Unit,
    onDismiss: () -> Unit,
) {
    var creating by rememberSaveable { mutableStateOf(false) }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = Spacing.lg).padding(bottom = Spacing.xl), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            ChoiceRow(stringResource(R.string.ui_no_branch), selected == null) { onPick(null) }
            branches.forEach { b -> ChoiceRow(listOfNotNull(b.name, b.detail).joinToString(" · "), b.id == selected) { onPick(b) } }
            HorizontalDivider()
            if (!creating) {
                TextButton(onClick = { creating = true }, modifier = Modifier.heightIn(min = Spacing.touchTarget)) { Text(stringResource(R.string.ui_branches_new)) }
            } else {
                var name by rememberSaveable { mutableStateOf("") }
                var city by rememberSaveable { mutableStateOf(defaultCity) }
                OutlinedTextField(value = name, onValueChange = { name = it.take(200) }, label = { Text(stringResource(R.string.ui_branches_name)) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(value = city, onValueChange = { city = it.take(100) }, label = { Text(stringResource(R.string.ui_branches_city)) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Button(onClick = { onCreate(name, city) }, enabled = name.isNotBlank(), modifier = Modifier.fillMaxWidth().heightIn(min = Spacing.touchTarget)) { Text(stringResource(R.string.ui_stores_add)) }
            }
        }
    }
}

@Composable
private fun ChoiceRow(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = Spacing.touchTarget).clickable(role = Role.RadioButton, onClick = onClick),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        RadioButton(selected = selected, onClick = null)
        Text(label, style = MaterialTheme.typography.bodyLarge)
    }
}
