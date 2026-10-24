package com.maubautista.maunedas.core.camera

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import com.maubautista.maunedas.core.designsystem.Spacing

/** [content] once the camera may be used; otherwise [denied] with a way to ask for it. */
@Composable
fun WithCameraPermission(
    denied: @Composable (request: () -> Unit) -> Unit = { CameraPermissionRequest(it) },
    content: @Composable () -> Unit,
) {
    val context = LocalContext.current
    var allowed by remember { mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) }
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { allowed = it }
    if (allowed) content() else denied { ask.launch(Manifest.permission.CAMERA) }
}

@Composable
fun CameraPermissionRequest(
    onAllow: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier.padding(Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Text(stringResource(R.string.camera_permission), style = MaterialTheme.typography.bodyLarge)
        Button(onClick = onAllow, modifier = Modifier.fillMaxWidth().heightIn(min = Spacing.touchTarget)) { Text(stringResource(R.string.camera_allow)) }
    }
}

/** One read for a form ("Escanear código" in S-10): the first code closes the sheet. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ScanCodeSheet(
    onCode: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    var done by remember { mutableStateOf(false) }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.padding(horizontal = Spacing.lg).padding(bottom = Spacing.xl), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            Text(stringResource(R.string.camera_scan_code), style = MaterialTheme.typography.titleLarge)
            WithCameraPermission {
                BarcodeScanner(
                    onCode = { code ->
                        if (!done) {
                            done = true
                            onCode(code)
                        }
                    },
                    paused = done,
                    modifier = Modifier.fillMaxWidth().height(320.dp),
                )
            }
            TextButton(onClick = onDismiss, modifier = Modifier.heightIn(min = Spacing.touchTarget)) { Text(stringResource(R.string.camera_cancel)) }
        }
    }
}
