package com.maubautista.maunedas.core.camera

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.SystemClock
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import javax.inject.Inject
import kotlin.math.max
import kotlin.math.roundToInt

/** One rendition written by [PhotoCutout]. */
data class CutFile(
    val path: String,
    val width: Int,
    val height: Int,
)

/** "Sin fondo" for a reduced product photo: the three renditions of 10 §5 in [processed], [thumb] and [mask]. */
data class CutFiles(
    val processed: CutFile,
    val thumb: CutFile,
    val mask: CutFile,
)

/**
 * Cuts a product photo already reduced by `LocalPhotos` (T-118). The subject is looked for at most at
 * [ProductImageRenderer.PROCESSED_MAX] px, the size of the result, which keeps it under 2 s on a mid-range phone
 * (RF-IMG-03).
 */
class PhotoCutout
    @Inject
    constructor(
        private val cutter: SubjectCutter,
    ) {
        suspend fun isReady(): Boolean = cutter.isReady()

        fun prepare() = cutter.prepare()

        /** Writes `processed.webp`, `thumb.webp` and `mask.png` in [dir]; null when no subject is found. */
        suspend fun make(
            photo: File,
            dir: File,
        ): CutFiles? {
            val start = SystemClock.elapsedRealtime()
            val input = withContext(Dispatchers.IO) { decode(photo) } ?: return null
            val foreground = cutter.cut(input) ?: return null
            return withContext(Dispatchers.Default) {
                val rendered = ProductImageRenderer.render(foreground) ?: return@withContext null
                // RF-IMG-03 asks for less than 2 s on a mid-range phone; only the time and sizes are logged.
                Log.i(TAG, "cut ${input.width}x${input.height} in ${SystemClock.elapsedRealtime() - start} ms")
                dir.mkdirs()
                fun keep(
                    bitmap: Bitmap,
                    name: String,
                    write: (Bitmap, File) -> Unit,
                ) = File(dir, name).also { write(bitmap, it) }.let { CutFile(it.path, bitmap.width, bitmap.height) }
                CutFiles(
                    processed = keep(rendered.processed, "processed.webp", ProductImageRenderer::writeWebp),
                    thumb = keep(rendered.thumb, "thumb.webp", ProductImageRenderer::writeWebp),
                    mask = keep(rendered.mask, "mask.png", ProductImageRenderer::writePng),
                )
            }
        }

        private companion object {
            const val TAG = "PhotoCutout"
        }

        private fun decode(photo: File): Bitmap? {
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeFile(photo.path, bounds)
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
            var sample = 1
            while (max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= ProductImageRenderer.PROCESSED_MAX) sample *= 2
            val decoded = BitmapFactory.decodeFile(photo.path, BitmapFactory.Options().apply { inSampleSize = sample }) ?: return null
            val longest = max(decoded.width, decoded.height)
            if (longest <= ProductImageRenderer.PROCESSED_MAX) return decoded
            val scale = ProductImageRenderer.PROCESSED_MAX.toFloat() / longest
            return Bitmap.createScaledBitmap(decoded, (decoded.width * scale).roundToInt(), (decoded.height * scale).roundToInt(), true)
        }
    }
