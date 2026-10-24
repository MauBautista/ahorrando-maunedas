package com.maubautista.maunedas.core.camera

import android.content.Context
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.annotation.OptIn
import androidx.camera.core.Camera
import androidx.camera.core.ExperimentalGetImage
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.FilledIconToggleButton
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import com.maubautista.maunedas.core.designsystem.Spacing
import java.util.concurrent.Executors
import com.maubautista.maunedas.core.designsystem.R as DesignR

/** The formats of S-11. */
private val FORMATS = intArrayOf(Barcode.FORMAT_EAN_13, Barcode.FORMAT_EAN_8, Barcode.FORMAT_UPC_A, Barcode.FORMAT_UPC_E, Barcode.FORMAT_CODE_128)

/**
 * S-11 (05 §5): the back camera with ML Kit (bundled model, no network). Each new code (normalized, and not the same
 * one within 2 s) vibrates, beeps and reaches [onCode]; while [paused], reads are ignored (the result sheet is open).
 * The caller has the camera permission. `ImageProxy.image` is CameraX's documented way to hand frames to ML Kit.
 */
@OptIn(ExperimentalGetImage::class)
@Composable
fun BarcodeScanner(
    onCode: (String) -> Unit,
    paused: Boolean,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current
    val report by rememberUpdatedState(onCode)
    val isPaused by rememberUpdatedState(paused)
    var camera by remember { mutableStateOf<Camera?>(null) }
    var torch by remember { mutableStateOf(false) }
    val gate = remember { ScanGate() }
    val feedback = remember { ReadFeedback(context) }
    val description = stringResource(R.string.camera_preview)
    val previewView = remember { PreviewView(context).apply { scaleType = PreviewView.ScaleType.FILL_CENTER } }

    DisposableEffect(lifecycle) {
        val executor = Executors.newSingleThreadExecutor()
        val scanner = BarcodeScanning.getClient(BarcodeScannerOptions.Builder().setBarcodeFormats(FORMATS.first(), *FORMATS.drop(1).toIntArray()).build())
        val providerFuture = ProcessCameraProvider.getInstance(context)
        val main = ContextCompat.getMainExecutor(context)
        providerFuture.addListener({
            val provider = providerFuture.get()
            val preview = Preview.Builder().build().also { it.surfaceProvider = previewView.surfaceProvider }
            val analysis = ImageAnalysis.Builder().setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST).build()
            analysis.setAnalyzer(executor) { proxy ->
                val media = proxy.image
                if (media == null || isPaused) {
                    proxy.close()
                    return@setAnalyzer
                }
                scanner.process(InputImage.fromMediaImage(media, proxy.imageInfo.rotationDegrees))
                    .addOnSuccessListener(main) { barcodes ->
                        val code = barcodes.firstNotNullOfOrNull { b -> b.rawValue?.let(ScanCodes::normalize) }
                        if (code != null && !isPaused && gate.accept(code, System.currentTimeMillis())) {
                            feedback.play()
                            report(code)
                        }
                    }.addOnCompleteListener { proxy.close() }
            }
            provider.unbindAll()
            camera = provider.bindToLifecycle(lifecycle, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
        }, main)
        onDispose {
            runCatching { providerFuture.get().unbindAll() }
            scanner.close()
            executor.shutdown()
            feedback.release()
        }
    }

    Box(modifier) {
        AndroidView(factory = { previewView }, modifier = Modifier.fillMaxSize().semantics { contentDescription = description })
        if (camera?.cameraInfo?.hasFlashUnit() == true) {
            FilledIconToggleButton(
                checked = torch,
                onCheckedChange = {
                    torch = it
                    camera?.cameraControl?.enableTorch(it)
                },
                modifier = Modifier.align(Alignment.TopEnd).padding(Spacing.lg),
            ) {
                Icon(
                    painterResource(DesignR.drawable.ic_flashlight),
                    contentDescription = stringResource(if (torch) R.string.camera_torch_off else R.string.camera_torch_on),
                )
            }
        }
    }
}

/** A short vibration and beep when a code is read (S-11). */
private class ReadFeedback(
    context: Context,
) {
    // VibratorManager exists from Android 12; minSdk is 26.
    private val vibrator: Vibrator? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            context.getSystemService(VibratorManager::class.java)?.defaultVibrator
        } else {
            context.getSystemService(Vibrator::class.java)
        }
    private val tone = runCatching { ToneGenerator(AudioManager.STREAM_NOTIFICATION, 60) }.getOrNull()

    fun play() {
        runCatching { vibrator?.vibrate(VibrationEffect.createOneShot(60, VibrationEffect.DEFAULT_AMPLITUDE)) }
        tone?.startTone(ToneGenerator.TONE_PROP_BEEP, 120)
    }

    fun release() {
        tone?.release()
    }
}
