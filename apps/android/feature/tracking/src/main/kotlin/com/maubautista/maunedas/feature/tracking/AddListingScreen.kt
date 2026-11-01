package com.maubautista.maunedas.feature.tracking

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
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.maubautista.maunedas.core.data.VariantOption
import com.maubautista.maunedas.core.designsystem.Spacing
import com.maubautista.maunedas.core.designsystem.R as DesignR

data class AddListingActions(
    val onBack: () -> Unit = {},
    val onText: (String) -> Unit = {},
    val onResolve: () -> Unit = {},
    val onOtherLink: () -> Unit = {},
    val onQuery: (String) -> Unit = {},
    val onChoose: (VariantOption) -> Unit = {},
    val onChangeVariant: () -> Unit = {},
    val onSave: () -> Unit = {},
)

/** S-21 as a screen: it is also where a link shared from a store's app lands. */
@Composable
fun AddListingRoute(
    onDone: () -> Unit,
    viewModel: AddListingViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    LaunchedEffect(viewModel) { viewModel.done.collect { onDone() } }
    AddListingScreen(
        state = state,
        actions =
            AddListingActions(
                onBack = onDone,
                onText = viewModel::onText,
                onResolve = viewModel::resolve,
                onOtherLink = viewModel::otherLink,
                onQuery = viewModel::onQuery,
                onChoose = viewModel::choose,
                onChangeVariant = viewModel::changeVariant,
                onSave = viewModel::save,
            ),
    )
}

@Composable
fun AddListingScreen(
    state: AddListingState,
    actions: AddListingActions,
) {
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            IconButton(onClick = actions.onBack) {
                Icon(painterResource(DesignR.drawable.ic_arrow_back), contentDescription = stringResource(R.string.tracking_back))
            }
            Text(stringResource(R.string.add_title), style = MaterialTheme.typography.titleLarge, modifier = Modifier.semantics { heading() })
        }
        val link = state.link
        if (link == null) {
            OutlinedTextField(
                value = state.text,
                onValueChange = actions.onText,
                label = { Text(stringResource(R.string.add_link_label)) },
                placeholder = { Text(stringResource(R.string.add_link_hint)) },
                minLines = 3,
                modifier = Modifier.fillMaxWidth(),
            )
            Problem(state)
            Button(
                onClick = actions.onResolve,
                enabled = state.text.isNotBlank() && !state.resolving,
                modifier = Modifier.heightIn(min = Spacing.touchTarget),
            ) { Text(stringResource(if (state.resolving) R.string.add_resolving else R.string.add_continue)) }
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Text(link.storeName ?: stringResource(R.string.add_store_unknown), style = MaterialTheme.typography.titleMedium)
                Text(link.canonicalUrl, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            val twin = link.followedBy
            if (twin != null) {
                Text(stringResource(R.string.add_followed, twin), color = MaterialTheme.colorScheme.error)
            } else {
                Text(stringResource(R.string.add_variant), style = MaterialTheme.typography.titleSmall)
                VariantPicker(state, actions)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                TextButton(onClick = actions.onOtherLink, modifier = Modifier.heightIn(min = Spacing.touchTarget)) { Text(stringResource(R.string.add_other)) }
                Button(onClick = actions.onSave, enabled = state.canSave, modifier = Modifier.heightIn(min = Spacing.touchTarget)) {
                    Text(stringResource(if (state.saving) R.string.add_saving else R.string.add_save))
                }
            }
        }
    }
}

@Composable
private fun Problem(state: AddListingState) {
    val text = state.problem?.let { stringResource(it) } ?: state.problemText ?: return
    Text(text, color = MaterialTheme.colorScheme.error)
}

@Composable
private fun VariantPicker(
    state: AddListingState,
    actions: AddListingActions,
) {
    val chosen = state.variant
    if (chosen != null) {
        Card(Modifier.fillMaxWidth()) {
            Row(Modifier.fillMaxWidth().padding(Spacing.md), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text(chosen.name, modifier = Modifier.weight(1f))
                TextButton(onClick = actions.onChangeVariant) { Text(stringResource(R.string.add_change)) }
            }
        }
        return
    }
    OutlinedTextField(
        value = state.query,
        onValueChange = actions.onQuery,
        label = { Text(stringResource(R.string.add_search)) },
        singleLine = true,
        modifier = Modifier.fillMaxWidth(),
    )
    if (state.searched && state.results.isEmpty()) {
        Text(stringResource(R.string.add_no_results), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    state.results.forEach { option ->
        Text(
            listOfNotNull(option.name, option.brand).joinToString(" · "),
            modifier = Modifier.fillMaxWidth().clickable { actions.onChoose(option) }.padding(vertical = Spacing.sm),
        )
    }
}
