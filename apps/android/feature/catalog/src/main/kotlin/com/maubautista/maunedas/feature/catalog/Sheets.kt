package com.maubautista.maunedas.feature.catalog

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import com.maubautista.maunedas.core.designsystem.Spacing

internal data class Choice(
    val id: String,
    val label: String,
    val depth: Int,
)

/** A single choice with "all" on top; subcategories are indented under their parent. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ChoiceSheet(
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
            if (options.isEmpty() && emptyLabel != null) item { Text(emptyLabel, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(Spacing.xl)) }
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
