package com.maubautista.maunedas.core.designsystem.component

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import com.maubautista.maunedas.core.designsystem.R
import com.maubautista.maunedas.core.designsystem.Spacing

data class StoreOption(val id: String, val name: String)

/** The store of a purchase or a shelf price, from the live stores (lookups). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StorePicker(
    stores: List<StoreOption>,
    selectedId: String?,
    onSelect: (StoreOption) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
) {
    var expanded by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(expanded = expanded, onExpandedChange = { expanded = it }, modifier = modifier) {
        OutlinedTextField(
            value = stores.firstOrNull { it.id == selectedId }?.name ?: "",
            onValueChange = {},
            readOnly = true,
            label = { Text(label) },
            placeholder = { Text(stringResource(R.string.ds_choose_store)) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
            singleLine = true,
            modifier =
                Modifier
                    .menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable)
                    .fillMaxWidth()
                    .heightIn(min = Spacing.touchTarget),
        )
        ExposedDropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            for (store in stores) {
                DropdownMenuItem(
                    text = { Text(store.name) },
                    onClick = {
                        onSelect(store)
                        expanded = false
                    },
                    modifier = Modifier.heightIn(min = Spacing.touchTarget),
                )
            }
        }
    }
}

data class VariantOption(val variantId: String, val productName: String, val variantLabel: String, val brand: String?)

/**
 * Search for a variant (purchase editor, receipt review): the caller searches Room with SearchKey and passes
 * the results; picking one reports it.
 */
@Composable
fun VariantSearchField(
    query: String,
    onQueryChange: (String) -> Unit,
    results: List<VariantOption>,
    onSelect: (VariantOption) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
) {
    Column(modifier) {
        OutlinedTextField(
            value = query,
            onValueChange = onQueryChange,
            label = { Text(label) },
            singleLine = true,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            modifier = Modifier.fillMaxWidth().heightIn(min = Spacing.touchTarget),
        )
        if (query.isNotBlank() && results.isEmpty()) {
            Text(stringResource(R.string.ds_no_results), style = MaterialTheme.typography.bodyMedium)
        }
        for (option in results) {
            // A plain column instead of ListItem, whose slots cut long names at 200 % font (RNF-08).
            Column(
                Modifier
                    .fillMaxWidth()
                    .heightIn(min = Spacing.touchTarget)
                    .clickable { onSelect(option) }
                    .padding(horizontal = Spacing.lg, vertical = Spacing.sm),
            ) {
                Text(option.productName, style = MaterialTheme.typography.bodyLarge)
                Text(
                    listOfNotNull(option.variantLabel, option.brand).joinToString(" · "),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}
