package com.maubautista.maunedas.core.camera

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import java.io.File
import java.util.UUID

/**
 * "Tomar foto" with the phone's camera app (10 §4.2). The full-size photo lands in `cacheDir/capture/` through this
 * module's FileProvider and [onTaken] gets it to reduce; a cancelled shot leaves nothing behind. The camera permission
 * is asked first: the app declares it for the scanner, so the camera app would refuse without it.
 */
@Composable
fun rememberTakePhoto(onTaken: (File) -> Unit): () -> Unit {
    val context = LocalContext.current
    var pending by rememberSaveable { mutableStateOf<String?>(null) }
    val take =
        rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
            val file = pending?.let(::File)
            pending = null
            if (ok && file != null && file.length() > 0) onTaken(file) else file?.delete()
        }

    fun launch() {
        val file = captureFile(context)
        pending = file.path
        try {
            take.launch(FileProvider.getUriForFile(context, "${context.packageName}.photos", file))
        } catch (_: ActivityNotFoundException) {
            // No camera app (some emulators): nothing to take.
            pending = null
            file.delete()
        }
    }
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted -> if (granted) launch() }
    return {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) launch() else ask.launch(Manifest.permission.CAMERA)
    }
}

private fun captureFile(context: Context): File = File(context.cacheDir, "capture").apply { mkdirs() }.resolve("${UUID.randomUUID()}.jpg")
