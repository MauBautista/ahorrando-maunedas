package com.maubautista.maunedas.feature.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
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
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.maubautista.maunedas.core.designsystem.Spacing
import com.maubautista.maunedas.core.sync.SyncStatus
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private val TIME = DateTimeFormatter.ofPattern("HH:mm").withZone(ZoneId.of("America/Mexico_City"))

@Composable
fun HomeRoute(
    onSignedOut: () -> Unit,
    viewModel: HomeViewModel = hiltViewModel(),
) {
    val user by viewModel.user.collectAsStateWithLifecycle()
    val sync by viewModel.sync.collectAsStateWithLifecycle()
    val pending by viewModel.confirmSignOut.collectAsStateWithLifecycle()
    LaunchedEffect(viewModel) { viewModel.signedOut.collect { onSignedOut() } }

    Column(Modifier.fillMaxSize().padding(Spacing.xl), verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
        Text(stringResource(R.string.home_hello, user?.displayName.orEmpty()), style = MaterialTheme.typography.headlineSmall)
        Text(
            when (val s = sync) {
                SyncStatus.Idle -> stringResource(R.string.home_sync_idle)
                is SyncStatus.Synced -> stringResource(R.string.home_sync_ok, TIME.format(Instant.ofEpochMilli(s.at)))
                is SyncStatus.Failed -> stringResource(R.string.home_sync_failed, s.reason)
                SyncStatus.UpgradeRequired -> stringResource(R.string.home_sync_upgrade)
            },
            style = MaterialTheme.typography.bodyLarge,
        )
        Button(onClick = viewModel::syncNow, modifier = Modifier.fillMaxWidth().heightIn(min = Spacing.touchTarget)) {
            Text(stringResource(R.string.home_sync_now))
        }
        OutlinedButton(onClick = viewModel::askSignOut, modifier = Modifier.fillMaxWidth().heightIn(min = Spacing.touchTarget)) {
            Text(stringResource(R.string.home_sign_out))
        }
    }
    pending?.let { count ->
        AlertDialog(
            onDismissRequest = viewModel::dismissSignOut,
            text = { Text(pluralStringResource(R.plurals.home_sign_out_pending, count, count)) },
            confirmButton = { TextButton(onClick = viewModel::signOut) { Text(stringResource(R.string.home_sign_out_confirm)) } },
            dismissButton = { TextButton(onClick = viewModel::dismissSignOut) { Text(stringResource(R.string.home_cancel)) } },
        )
    }
}
