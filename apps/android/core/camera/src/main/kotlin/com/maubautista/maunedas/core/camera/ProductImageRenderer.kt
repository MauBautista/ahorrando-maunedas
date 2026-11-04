package com.maubautista.maunedas.core.camera

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import android.os.Build
import java.io.File
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * 10 §5's post-processing of a cut subject: the three renditions of tier `device`.
 * 1. Crop to the pixels with alpha > 0.
 * 2. Center on a square canvas with a margin of 8 % of the subject's longer side on each side.
 * 3. `processed`: WebP with alpha, side ≤ 1024.
 * 4. `thumb`: 256 px over the background (white by default), WebP.
 * 5. `mask`: the cut's alpha over the whole photo it got (≤ 1024 px), as a grayscale PNG, so the editor lays it on the
 *    original to erase and restore (10 §6.2, decisión T106).
 */
object ProductImageRenderer {
    const val PROCESSED_MAX = 1024
    const val THUMB_SIDE = 256
    const val MARGIN = 0.08f
    const val QUALITY = 85

    class Rendered(
        val processed: Bitmap,
        val thumb: Bitmap,
        val mask: Bitmap,
    )

    /** Null when [foreground] has no visible pixel. */
    fun render(
        foreground: Bitmap,
        background: Int = Color.WHITE,
    ): Rendered? {
        val box = opaqueBounds(foreground) ?: return null
        val longer = max(box.width(), box.height())
        val margin = (longer * MARGIN).roundToInt()
        val side = longer + 2 * margin
        val scale = minOf(1f, PROCESSED_MAX.toFloat() / side)
        val out = max(1, (side * scale).roundToInt())
        val processed = Bitmap.createBitmap(out, out, Bitmap.Config.ARGB_8888)
        val left = margin + (longer - box.width()) / 2f
        val top = margin + (longer - box.height()) / 2f
        val target = Rect((left * scale).roundToInt(), (top * scale).roundToInt(), ((left + box.width()) * scale).roundToInt(), ((top + box.height()) * scale).roundToInt())
        val paint = Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG)
        Canvas(processed).drawBitmap(foreground, box, target, paint)
        val thumb = Bitmap.createBitmap(THUMB_SIDE, THUMB_SIDE, Bitmap.Config.ARGB_8888)
        Canvas(thumb).apply {
            drawColor(background)
            drawBitmap(processed, null, Rect(0, 0, THUMB_SIDE, THUMB_SIDE), paint)
        }
        return Rendered(processed, thumb, maskOf(foreground))
    }

    /** The smallest rectangle holding every pixel with alpha > 0. */
    fun opaqueBounds(bitmap: Bitmap): Rect? {
        val w = bitmap.width
        val h = bitmap.height
        val row = IntArray(w)
        var left = w
        var top = h
        var right = -1
        var bottom = -1
        for (y in 0 until h) {
            bitmap.getPixels(row, 0, w, 0, y, w, 1)
            for (x in 0 until w) {
                if (row[x] ushr 24 == 0) continue
                if (x < left) left = x
                if (x > right) right = x
                if (y < top) top = y
                bottom = y
            }
        }
        return if (right < 0) null else Rect(left, top, right + 1, bottom + 1)
    }

    private fun maskOf(cut: Bitmap): Bitmap {
        val w = cut.width
        val h = cut.height
        val pixels = IntArray(w * h)
        cut.getPixels(pixels, 0, w, 0, 0, w, h)
        for (i in pixels.indices) {
            val a = pixels[i] ushr 24
            pixels[i] = Color.rgb(a, a, a)
        }
        return Bitmap.createBitmap(pixels, w, h, Bitmap.Config.ARGB_8888)
    }

    /** WebP keeping alpha: lossy from API 30, the old WebP format before (10 §5). */
    fun writeWebp(
        bitmap: Bitmap,
        file: File,
    ) {
        val format =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                Bitmap.CompressFormat.WEBP_LOSSY
            } else {
                @Suppress("DEPRECATION")
                Bitmap.CompressFormat.WEBP
            }
        file.outputStream().use { bitmap.compress(format, QUALITY, it) }
    }

    fun writePng(
        bitmap: Bitmap,
        file: File,
    ) {
        file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }
}
