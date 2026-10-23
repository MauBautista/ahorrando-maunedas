package com.maubautista.maunedas.feature.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.maubautista.maunedas.core.data.BarcodeConflict
import com.maubautista.maunedas.core.data.PendingTable
import com.maubautista.maunedas.core.data.RejectedChange
import com.maubautista.maunedas.core.designsystem.Spacing
import com.maubautista.maunedas.core.sync.SyncStatus
import com.maubautista.maunedas.core.ui.Dates
import com.maubautista.maunedas.core.ui.clock24h
import com.maubautista.maunedas.core.designsystem.R as DesignR

@Composable
fun SyncStatusRoute(
    onBack: () -> Unit,
    viewModel: SyncStatusViewModel = hiltViewModel(),
) {
    val sync by viewModel.sync.collectAsStateWithLifecycle()
    val pending by viewModel.pending.collectAsStateWithLifecycle()
    val uploads by viewModel.uploads.collectAsStateWithLifecycle()
    val rejected by viewModel.rejected.collectAsStateWithLifecycle()
    SyncStatusScreen(sync, pending, uploads, rejected, viewModel.now(), onBack, viewModel::syncNow, viewModel::dismiss)
}

/** S-16 (05 §5, RF-SYN-04): last sync, pending per table, uploads, last error and "Cambios rechazados". */
@Composable
fun SyncStatusScreen(
    sync: SyncStatus,
    pending: List<PendingTable>,
    uploads: Int,
    rejected: List<RejectedChange>,
    now: Long,
    onBack: () -> Unit,
    onSyncNow: () -> Unit,
    onDismiss: (Long) -> Unit,
) {
    LazyColumn(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        item {
            Column(Modifier.padding(horizontal = Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = onBack) { Icon(painterResource(DesignR.drawable.ic_arrow_back), contentDescription = stringResource(R.string.sync_back)) }
                    Text(stringResource(R.string.sync_title), style = MaterialTheme.typography.headlineSmall, modifier = Modifier.semantics { heading() })
                }
                Text(
                    when (sync) {
                        is SyncStatus.Synced -> stringResource(R.string.sync_last, "${Dates.day(sync.at, now, clock24h())}")
                        SyncStatus.Idle -> stringResource(R.string.sync_never)
                        else -> syncText(sync)
                    },
                    style = MaterialTheme.typography.bodyLarge,
                )
                if (sync is SyncStatus.Failed) {
                    Title(R.string.sync_errors_title)
                    Text(syncText(sync), style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.error)
                }
                Button(onClick = onSyncNow, modifier = Modifier.fillMaxWidth().heightIn(min = Spacing.touchTarget)) { Text(stringResource(R.string.settings_sync_now)) }
                Title(R.string.sync_pending_title)
                if (pending.isEmpty()) Text(stringResource(R.string.sync_nothing_pending), style = MaterialTheme.typography.bodyLarge)
                pending.forEach { Text(stringResource(R.string.sync_table_count, stringResource(tableName(it.table)), it.count), style = MaterialTheme.typography.bodyLarge) }
                if (uploads > 0) Text(stringResource(R.string.sync_uploads, uploads), style = MaterialTheme.typography.bodyLarge)
                Title(R.string.sync_rejected_title)
                if (rejected.isEmpty()) Text(stringResource(R.string.sync_no_rejected), style = MaterialTheme.typography.bodyLarge)
            }
        }
        items(rejected, key = { it.id }) { RejectedCard(it, now) { onDismiss(it.id) } }
    }
}

@Composable
private fun Title(text: Int) {
    Text(stringResource(text), style = MaterialTheme.typography.titleMedium, modifier = Modifier.semantics { heading() })
}

@Composable
private fun RejectedCard(
    change: RejectedChange,
    now: Long,
    onDismiss: () -> Unit,
) {
    Card(Modifier.fillMaxWidth().padding(horizontal = Spacing.lg)) {
        Column(Modifier.padding(Spacing.md), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            val what = listOfNotNull(stringResource(tableName(change.table)), change.label).joinToString(": ")
            Text(stringResource(R.string.sync_rejected_item, what, reasonText(change)), style = MaterialTheme.typography.bodyLarge)
            Text(Dates.day(change.createdAt, now, clock24h()), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            TextButton(onClick = onDismiss, modifier = Modifier.heightIn(min = Spacing.touchTarget)) { Text(stringResource(R.string.sync_dismiss)) }
        }
    }
}

/**
 * S-17 (04 §6.5): my barcode is already another variant's. "Usar esa presentación" moves my lines, prices and photos
 * to it and deletes my code; "Mantener separado" only deletes my code. Either way the dialog goes away.
 */
@Composable
fun BarcodeConflictDialog(
    conflict: BarcodeConflict,
    onUseTheirs: () -> Unit,
    onKeepSeparate: () -> Unit,
) {
    val theirs = conflict.theirVariantName ?: stringResource(R.string.conflict_someone_else)
    val mine = conflict.myVariantName ?: stringResource(R.string.conflict_someone_else)
    AlertDialog(
        onDismissRequest = {},
        title = { Text(stringResource(R.string.conflict_title)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                Text(stringResource(R.string.conflict_text, conflict.code, theirs, mine))
                Text(stringResource(R.string.conflict_use_theirs_hint, mine, theirs), style = MaterialTheme.typography.bodyMedium)
            }
        },
        confirmButton = { TextButton(onClick = onUseTheirs) { Text(stringResource(R.string.conflict_use_theirs)) } },
        dismissButton = { TextButton(onClick = onKeepSeparate) { Text(stringResource(R.string.conflict_keep)) } },
    )
}

/**
 * What sync has to say over any screen (04 §6.5): the barcode dialog until it is answered, and a snackbar when another
 * device's change won over one of ours.
 */
@Composable
fun SyncMessagesHost(
    snackbar: androidx.compose.material3.SnackbarHostState,
    viewModel: SyncConflictsViewModel = hiltViewModel(),
) {
    val conflict by viewModel.conflict.collectAsStateWithLifecycle()
    val elsewhere = stringResource(R.string.stale_notice, "%s")
    val unknown = stringResource(R.string.stale_unknown)
    androidx.compose.runtime.LaunchedEffect(viewModel) {
        viewModel.updatedElsewhere.collect { name -> snackbar.showSnackbar(elsewhere.replace("%s", name?.let { "«$it»" } ?: unknown)) }
    }
    conflict?.let { c -> BarcodeConflictDialog(c, onUseTheirs = { viewModel.useTheirs(c) }, onKeepSeparate = { viewModel.keepSeparate(c) }) }
}
