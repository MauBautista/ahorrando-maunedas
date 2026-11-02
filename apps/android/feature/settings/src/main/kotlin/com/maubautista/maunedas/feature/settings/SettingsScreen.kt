package com.maubautista.maunedas.feature.settings

import android.text.format.Formatter
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.maubautista.maunedas.core.auth.SessionUser
import com.maubautista.maunedas.core.data.AgentHealth
import com.maubautista.maunedas.core.data.BackupJob
import com.maubautista.maunedas.core.designsystem.Spacing
import com.maubautista.maunedas.core.sync.SyncStatus
import com.maubautista.maunedas.core.ui.Dates
import com.maubautista.maunedas.core.ui.clock24h

/** What S-15 can ask for. */
data class SettingsActions(
    val onChangePassword: () -> Unit = {},
    val onOpenSync: () -> Unit = {},
    val onSyncNow: () -> Unit = {},
    val onFreeSpace: () -> Unit = {},
    val onSignOut: () -> Unit = {},
)

@Composable
fun SettingsRoute(
    onSignedOut: () -> Unit,
    onOpenSync: () -> Unit,
    viewModel: SettingsViewModel = hiltViewModel(),
) {
    val user by viewModel.user.collectAsStateWithLifecycle()
    val sync by viewModel.sync.collectAsStateWithLifecycle()
    val pending by viewModel.pending.collectAsStateWithLifecycle()
    val photos by viewModel.photosBytes.collectAsStateWithLifecycle()
    val password by viewModel.password.collectAsStateWithLifecycle()
    val message by viewModel.message.collectAsStateWithLifecycle()
    val confirmSignOut by viewModel.confirmSignOut.collectAsStateWithLifecycle()
    val agent by viewModel.agent.collectAsStateWithLifecycle()
    LaunchedEffect(viewModel) { viewModel.signedOut.collect { onSignedOut() } }
    // The tab keeps its view model; photos taken or freed meanwhile change the size, so it is read each time it shows.
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { viewModel.refreshPhotos() }
    SettingsScreen(
        user = user,
        sync = sync,
        pending = pending,
        photosBytes = photos,
        version = viewModel.client.appVersion,
        schema = viewModel.client.schema,
        actions = SettingsActions(viewModel::openPassword, onOpenSync, viewModel::syncNow, viewModel::freeSpace, viewModel::askSignOut),
        canChangePassword = viewModel.canChangePassword,
        agent = AgentSection(agent, viewModel.now()),
    )
    password?.let { PasswordDialog(it, viewModel::onPassword, viewModel::changePassword, viewModel::closePassword) }
    message?.let { m ->
        val context = LocalContext.current
        val text =
            when (m) {
                is SettingsViewModel.Message.Text -> stringResource(m.text)
                is SettingsViewModel.Message.Freed -> stringResource(R.string.settings_freed, Formatter.formatShortFileSize(context, m.bytes))
            }
        AlertDialog(
            onDismissRequest = viewModel::dismissMessage,
            text = { Text(text) },
            confirmButton = { TextButton(onClick = viewModel::dismissMessage) { Text(stringResource(R.string.settings_ok)) } },
        )
    }
    confirmSignOut?.let { count ->
        AlertDialog(
            onDismissRequest = viewModel::dismissSignOut,
            text = { Text(pluralStringResource(R.plurals.settings_sign_out_pending, count, count)) },
            confirmButton = { TextButton(onClick = viewModel::signOut) { Text(stringResource(R.string.settings_sign_out_confirm)) } },
            dismissButton = { TextButton(onClick = viewModel::dismissSignOut) { Text(stringResource(R.string.settings_cancel)) } },
        )
    }
}

/** S-15 (05 §5): account, sync, storage, about, sign out. */
@Composable
fun SettingsScreen(
    user: SessionUser?,
    sync: SyncStatus,
    pending: Int,
    photosBytes: Long?,
    version: String,
    schema: Int,
    actions: SettingsActions,
    canChangePassword: Boolean = true,
    agent: AgentSection = AgentSection(null, 0),
) {
    var freeing by rememberSaveable { mutableStateOf(false) }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Text(stringResource(R.string.settings_title), style = MaterialTheme.typography.headlineSmall, modifier = Modifier.semantics { heading() })
        Section(R.string.settings_account_title)
        user?.let { Text(stringResource(R.string.settings_user, it.displayName, it.username), style = MaterialTheme.typography.bodyLarge) }
        if (canChangePassword) {
            OutlinedButton(onClick = actions.onChangePassword, modifier = Modifier.fillMaxWidth().heightIn(min = Spacing.touchTarget)) { Text(stringResource(R.string.settings_change_password)) }
        } else {
            // A Google session is its own Firebase account, without a password (T76).
            Text(stringResource(R.string.settings_password_google), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        HorizontalDivider()
        Section(R.string.settings_sync_title)
        Text(syncText(sync), style = MaterialTheme.typography.bodyLarge)
        if (pending > 0) Text(pluralStringResource(R.plurals.settings_pending, pending, pending), style = MaterialTheme.typography.bodyLarge)
        Button(onClick = actions.onSyncNow, modifier = Modifier.fillMaxWidth().heightIn(min = Spacing.touchTarget)) { Text(stringResource(R.string.settings_sync_now)) }
        OutlinedButton(onClick = actions.onOpenSync, modifier = Modifier.fillMaxWidth().heightIn(min = Spacing.touchTarget)) { Text(stringResource(R.string.settings_sync_details)) }
        HorizontalDivider()
        if (user?.role == "admin") {
            Section(R.string.settings_agent_title)
            AgentStatusText(agent)
            HorizontalDivider()
        }
        Section(R.string.settings_storage_title)
        photosBytes?.let { Text(stringResource(R.string.settings_photos_size, Formatter.formatShortFileSize(LocalContext.current, it)), style = MaterialTheme.typography.bodyLarge) }
        OutlinedButton(onClick = { freeing = true }, modifier = Modifier.fillMaxWidth().heightIn(min = Spacing.touchTarget)) { Text(stringResource(R.string.settings_free_space)) }
        HorizontalDivider()
        Section(R.string.settings_about_title)
        Text(stringResource(R.string.settings_version, version, schema), style = MaterialTheme.typography.bodyLarge)
        HorizontalDivider()
        OutlinedButton(onClick = actions.onSignOut, modifier = Modifier.fillMaxWidth().heightIn(min = Spacing.touchTarget)) { Text(stringResource(R.string.settings_sign_out)) }
    }
    if (freeing) {
        AlertDialog(
            onDismissRequest = { freeing = false },
            text = { Text(stringResource(R.string.settings_free_space_confirm)) },
            confirmButton = { TextButton(onClick = { freeing = false; actions.onFreeSpace() }) { Text(stringResource(R.string.settings_free_space)) } },
            dismissButton = { TextButton(onClick = { freeing = false }) { Text(stringResource(R.string.settings_cancel)) } },
        )
    }
}

@Composable
internal fun syncText(sync: SyncStatus): String =
    when (sync) {
        SyncStatus.Idle -> stringResource(R.string.settings_sync_idle)
        is SyncStatus.Synced -> stringResource(R.string.settings_sync_ok, Dates.time(sync.at, clock24h()))
        is SyncStatus.Failed -> stringResource(R.string.settings_sync_failed, sync.reason)
        SyncStatus.UpgradeRequired -> stringResource(R.string.settings_sync_upgrade)
    }

/** RF-ADM-03 for the admin: the agent's latest report and when it was taken. */
data class AgentSection(
    val health: AgentHealth?,
    val now: Long,
)

@Composable
private fun AgentStatusText(section: AgentSection) {
    val a = section.health
    val now = section.now
    val style = MaterialTheme.typography.bodyLarge
    if (a?.lastHeartbeatAt == null) {
        Text(stringResource(R.string.settings_agent_never), style = style)
        return
    }
    val ago = Dates.agoTime(a.lastHeartbeatAt!!, now)
    if (a.online(now)) {
        Text(stringResource(R.string.settings_agent_online, ago), style = style)
    } else {
        Text(stringResource(R.string.settings_agent_offline, ago), style = style, color = MaterialTheme.colorScheme.error)
    }
    a.version?.let { Text(stringResource(R.string.settings_agent_version, it), style = style) }
    Text(stringResource(R.string.settings_agent_queue, a.due ?: 0, a.outbox ?: 0), style = style)
    Text(stringResource(R.string.settings_agent_blocked, a.blocked.joinToString(", ").ifEmpty { stringResource(R.string.settings_agent_none) }), style = style)
    Text(stringResource(R.string.settings_agent_error, a.lastError ?: stringResource(R.string.settings_agent_none)), style = style)
    Text(stringResource(R.string.settings_agent_mirror, jobText(a.mirror, now, R.string.settings_job_rows)), style = style)
    Text(stringResource(R.string.settings_agent_dump, jobText(a.dump, now, R.string.settings_job_file)), style = style)
    Text(stringResource(R.string.settings_agent_photos, jobText(a.photos, now, R.string.settings_job_files)), style = style)
}

@Composable
private fun jobText(
    job: BackupJob,
    now: Long,
    detail: Int,
): String =
    when (job.ok) {
        true -> listOfNotNull(job.detail?.let { stringResource(detail, it) }, job.at?.let { Dates.agoTime(it, now) }).joinToString(" · ")
        false -> stringResource(R.string.settings_job_failed, job.error.orEmpty())
        null -> job.error ?: stringResource(R.string.settings_job_not_yet)
    }

@Composable
private fun Section(text: Int) {
    Text(stringResource(text), style = MaterialTheme.typography.titleMedium, modifier = Modifier.semantics { heading() })
}

/** RF-AUTH-06: the current password, then the new one twice. */
@Composable
private fun PasswordDialog(
    form: PasswordForm,
    onChange: ((PasswordForm) -> PasswordForm) -> Unit,
    onSave: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.settings_change_password)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                PasswordField(form.current, R.string.settings_current_password) { v -> onChange { it.copy(current = v) } }
                PasswordField(form.new, R.string.settings_new_password) { v -> onChange { it.copy(new = v) } }
                PasswordField(form.repeat, R.string.settings_repeat_password) { v -> onChange { it.copy(repeat = v) } }
                form.error?.let { Text(stringResource(it), color = MaterialTheme.colorScheme.error) }
            }
        },
        confirmButton = { TextButton(onClick = onSave, enabled = !form.busy && form.current.isNotEmpty()) { Text(stringResource(R.string.settings_change_password)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.settings_cancel)) } },
    )
}

@Composable
private fun PasswordField(
    value: String,
    label: Int,
    onValue: (String) -> Unit,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValue,
        label = { Text(stringResource(label)) },
        singleLine = true,
        visualTransformation = PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
    )
}
