package com.maubautista.maunedas.feature.catalog

import androidx.annotation.StringRes
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import com.maubautista.maunedas.core.data.MergeCandidate
import com.maubautista.maunedas.core.data.MergeResult
import com.maubautista.maunedas.core.designsystem.Spacing

enum class MergeKind { PRODUCT, VARIANT }

/** An admin merge in progress (RF-CAT-07): who goes away ([sourceName]) and, once picked, where to. */
data class MergeState(
    val kind: MergeKind,
    val sourceId: String,
    val sourceName: String,
    val query: String = "",
    val target: MergeCandidate? = null,
    val busy: Boolean = false,
)

/** What to tell after a merge; null when it worked and the screen moves on by itself. */
@StringRes
fun MergeResult.message(): Int? =
    when (this) {
        MergeResult.Done -> null
        MergeResult.PendingChanges -> R.string.merge_pending
        MergeResult.NoNetwork -> R.string.merge_no_network
        is MergeResult.Invalid ->
            when (reason) {
                "MEASURE_MISMATCH" -> R.string.merge_measure
                "DELETED" -> R.string.merge_deleted
                else -> R.string.merge_failed
            }
        MergeResult.Forbidden -> R.string.merge_forbidden
        is MergeResult.Failed -> R.string.merge_failed
    }

fun MergeCandidate.title(): String = listOfNotNull(name, detail).joinToString(" · ")

/** Pick the target, then confirm what moves; the source is deleted (03 §11). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MergeSheet(
    state: MergeState,
    candidates: List<MergeCandidate>,
    onQuery: (String) -> Unit,
    onPick: (MergeCandidate?) -> Unit,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.padding(horizontal = Spacing.lg)) {
            Text(
                stringResource(if (state.kind == MergeKind.PRODUCT) R.string.merge_product_title else R.string.merge_variant_title, state.sourceName),
                style = MaterialTheme.typography.titleLarge,
            )
            OutlinedTextField(
                value = state.query,
                onValueChange = onQuery,
                label = { Text(stringResource(R.string.merge_search)) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().padding(vertical = Spacing.sm),
            )
        }
        LazyColumn(Modifier.padding(bottom = Spacing.xl)) {
            if (candidates.isEmpty()) item { Text(stringResource(R.string.merge_none), modifier = Modifier.padding(Spacing.lg)) }
            items(candidates, key = { it.id }) { c ->
                Text(
                    c.title(),
                    style = MaterialTheme.typography.bodyLarge,
                    modifier = Modifier.fillMaxWidth().heightIn(min = Spacing.touchTarget).clickable { onPick(c) }.padding(horizontal = Spacing.lg, vertical = Spacing.md),
                )
                HorizontalDivider()
            }
        }
    }
    state.target?.let { target ->
        val text =
            if (state.kind == MergeKind.PRODUCT) {
                stringResource(R.string.merge_product_confirm, state.sourceName, target.name)
            } else {
                stringResource(R.string.merge_variant_confirm, state.sourceName, target.title())
            }
        AlertDialog(
            onDismissRequest = { onPick(null) },
            text = { Text(text) },
            confirmButton = { TextButton(onClick = onConfirm, enabled = !state.busy) { Text(stringResource(R.string.merge_confirm), color = MaterialTheme.colorScheme.error) } },
            dismissButton = { TextButton(onClick = { onPick(null) }) { Text(stringResource(R.string.editor_cancel)) } },
        )
    }
}

/** The outcome of a merge that did not go through, or [R.string.merge_done]. */
@Composable
fun MergeMessage(
    @StringRes message: Int,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        text = { Text(stringResource(message)) },
        confirmButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.merge_ok)) } },
    )
}
