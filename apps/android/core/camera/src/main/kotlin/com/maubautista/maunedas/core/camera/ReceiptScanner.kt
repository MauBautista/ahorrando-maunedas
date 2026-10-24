package com.maubautista.maunedas.core.camera

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext
import com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions
import com.google.mlkit.vision.documentscanner.GmsDocumentScanning
import com.google.mlkit.vision.documentscanner.GmsDocumentScanningResult
import java.io.File

/**
 * "Foto de ticket" (RF-TIC-01): ML Kit's document scanner takes up to the pages asked for, cropped and straightened
 * (from the gallery too), without the camera permission. When Google Play services cannot open it (its module is
 * not downloaded yet and there is no network, or there are no Play services) the phone's camera app takes one page
 * instead, so a receipt can always be photographed. [onPages] gets copies in `cacheDir/capture/`, in page order.
 */
@Composable
fun rememberScanReceipt(onPages: (List<File>) -> Unit): (maxPages: Int) -> Unit {
    val context = LocalContext.current
    val takePhoto = rememberTakePhoto { onPages(listOf(it)) }
    val scan =
        rememberLauncherForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { result ->
            if (result.resultCode != Activity.RESULT_OK) return@rememberLauncherForActivityResult
            val pages = GmsDocumentScanningResult.fromActivityResultIntent(result.data)?.pages.orEmpty()
            pages.mapNotNull { copyToCapture(context, it.imageUri) }.takeIf { it.isNotEmpty() }?.let(onPages)
        }
    return { maxPages ->
        val activity = context.findActivity()
        if (activity == null) {
            takePhoto()
        } else {
            val options =
                GmsDocumentScannerOptions.Builder()
                    .setGalleryImportAllowed(true)
                    .setPageLimit(maxPages.coerceIn(1, MAX_PAGES))
                    .setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_JPEG)
                    .setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_FULL)
                    .build()
            GmsDocumentScanning.getClient(options).getStartScanIntent(activity)
                .addOnSuccessListener { sender -> scan.launch(IntentSenderRequest.Builder(sender).build()) }
                .addOnFailureListener { takePhoto() }
        }
    }
}

/** 09 §4.1: a receipt has 1 to 4 pages. */
private const val MAX_PAGES = 4

private tailrec fun Context.findActivity(): Activity? =
    when (this) {
        is Activity -> this
        is ContextWrapper -> baseContext.findActivity()
        else -> null
    }
