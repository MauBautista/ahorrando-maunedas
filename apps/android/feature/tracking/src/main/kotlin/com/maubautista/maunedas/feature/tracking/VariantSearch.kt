package com.maubautista.maunedas.feature.tracking

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import com.maubautista.maunedas.core.data.VariantOption
import com.maubautista.maunedas.core.designsystem.Spacing

/** The chosen variant with "Cambiar", or a search by name, brand or code to choose one (S-21, S-22). */
@Composable
internal fun VariantSearch(
    chosen: VariantOption?,
    query: String,
    results: List<VariantOption>,
    searched: Boolean,
    onQuery: (String) -> Unit,
    onChoose: (VariantOption) -> Unit,
    onChange: (() -> Unit)?,
) {
    if (chosen != null) {
        Card(Modifier.fillMaxWidth()) {
            Row(Modifier.fillMaxWidth().padding(Spacing.md), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text(chosen.name, modifier = Modifier.weight(1f))
                onChange?.let { TextButton(onClick = it) { Text(stringResource(R.string.add_change)) } }
            }
        }
        return
    }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        OutlinedTextField(
            value = query,
            onValueChange = onQuery,
            label = { Text(stringResource(R.string.add_search)) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        if (searched && results.isEmpty()) {
            Text(stringResource(R.string.add_no_results), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        results.forEach { option ->
            Text(
                listOfNotNull(option.name, option.brand).joinToString(" · "),
                modifier = Modifier.fillMaxWidth().clickable { onChoose(option) }.padding(vertical = Spacing.sm),
            )
        }
    }
}
