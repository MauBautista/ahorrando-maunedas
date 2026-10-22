package com.maubautista.maunedas.feature.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.maubautista.maunedas.core.designsystem.Spacing
import com.maubautista.maunedas.core.sync.SyncStatus
import com.maubautista.maunedas.core.ui.Dates
import com.maubautista.maunedas.core.ui.clock24h

@Composable
fun SettingsRoute(
    onSignedOut: () -> Unit,
    viewModel: SettingsViewModel = hiltViewModel(),
) {
    val user by viewModel.user.collectAsStateWithLifecycle()
    val sync by viewModel.sync.collectAsStateWithLifecycle()
    val pending by viewModel.confirmSignOut.collectAsStateWithLifecycle()
    LaunchedEffect(viewModel) { viewModel.signedOut.collect { onSignedOut() } }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(Spacing.xl), verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
        Text(stringResource(R.string.settings_title), style = MaterialTheme.typography.headlineSmall)
        user?.let { Text(stringResource(R.string.settings_account, it.displayName, it.username), style = MaterialTheme.typography.bodyLarge) }
        Text(
            when (val s = sync) {
                SyncStatus.Idle -> stringResource(R.string.settings_sync_idle)
                is SyncStatus.Synced -> stringResource(R.string.settings_sync_ok, Dates.time(s.at, clock24h()))
                is SyncStatus.Failed -> stringResource(R.string.settings_sync_failed, s.reason)
                SyncStatus.UpgradeRequired -> stringResource(R.string.settings_sync_upgrade)
            },
            style = MaterialTheme.typography.bodyLarge,
        )
        Button(onClick = viewModel::syncNow, modifier = Modifier.fillMaxWidth().heightIn(min = Spacing.touchTarget)) {
            Text(stringResource(R.string.settings_sync_now))
        }
        OutlinedButton(onClick = viewModel::askSignOut, modifier = Modifier.fillMaxWidth().heightIn(min = Spacing.touchTarget)) {
            Text(stringResource(R.string.settings_sign_out))
        }
    }
    pending?.let { count ->
        AlertDialog(
            onDismissRequest = viewModel::dismissSignOut,
            text = { Text(pluralStringResource(R.plurals.settings_sign_out_pending, count, count)) },
            confirmButton = { TextButton(onClick = viewModel::signOut) { Text(stringResource(R.string.settings_sign_out_confirm)) } },
            dismissButton = { TextButton(onClick = viewModel::dismissSignOut) { Text(stringResource(R.string.settings_cancel)) } },
        )
    }
}
