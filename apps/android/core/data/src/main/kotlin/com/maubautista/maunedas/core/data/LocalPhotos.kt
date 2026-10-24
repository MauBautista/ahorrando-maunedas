package com.maubautista.maunedas.core.data

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import androidx.exifinterface.media.ExifInterface
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.math.max

/**
 * Photos taken on the phone (10 §4.2): reduced and turned upright from their EXIF orientation, then kept as
 * `filesDir/images/{imageId}/original.jpg`, the file [com.maubautista.maunedas.core.sync.UploadQueue] uploads. The
 * reduced JPEG carries no EXIF, so no location leaves the phone.
 */
@Singleton
class LocalPhotos
    @Inject
    constructor(
        @ApplicationContext private val context: Context,
    ) {
        enum class Size(
            val maxPx: Int,
            val quality: Int,
        ) {
            PRODUCT(2048, 85),
            RECEIPT(1600, 80),
        }

        /** Reduces [taken] to [size] in the cache and deletes it; null when it is not an image. */
        suspend fun reduce(
            taken: File,
            size: Size,
        ): File? =
            withContext(Dispatchers.IO) {
                val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                BitmapFactory.decodeFile(taken.path, bounds)
                if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return@withContext null.also { taken.delete() }
                var sample = 1
                while (max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= size.maxPx) sample *= 2
                val decoded = BitmapFactory.decodeFile(taken.path, BitmapFactory.Options().apply { inSampleSize = sample })
                if (decoded == null) return@withContext null.also { taken.delete() }
                val longest = max(decoded.width, decoded.height)
                val scale = if (longest > size.maxPx) size.maxPx.toFloat() / longest else 1f
                val matrix = upright(ExifInterface(taken.path).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL))
                matrix.postScale(scale, scale)
                val out = Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, matrix, true)
                val file = File(taken.parentFile, "${taken.nameWithoutExtension}-reduced.jpg")
                file.outputStream().use { out.compress(Bitmap.CompressFormat.JPEG, size.quality, it) }
                taken.delete()
                file
            }

        /** Moves a reduced photo to the image's folder; returns the file to upload. */
        suspend fun keep(
            imageId: String,
            reduced: File,
        ): File =
            withContext(Dispatchers.IO) {
                val target = original(imageId)
                target.parentFile?.mkdirs()
                if (!reduced.renameTo(target)) {
                    reduced.copyTo(target, overwrite = true)
                    reduced.delete()
                }
                target
            }

        fun original(imageId: String): File = File(context.filesDir, "images/$imageId/$ORIGINAL")

        companion object {
            /** The blob name of a photo taken on the phone (`original_key = images/{id}/original.jpg`). */
            const val ORIGINAL = "original.jpg"

            /** The turn (and mirror) that makes an EXIF [orientation] upright. */
            internal fun upright(orientation: Int): Matrix =
                Matrix().apply {
                    when (orientation) {
                        ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> postScale(-1f, 1f)
                        ExifInterface.ORIENTATION_ROTATE_180 -> postRotate(180f)
                        ExifInterface.ORIENTATION_FLIP_VERTICAL -> postScale(1f, -1f)
                        ExifInterface.ORIENTATION_TRANSPOSE -> {
                            postRotate(90f)
                            postScale(-1f, 1f)
                        }
                        ExifInterface.ORIENTATION_ROTATE_90 -> postRotate(90f)
                        ExifInterface.ORIENTATION_TRANSVERSE -> {
                            postRotate(-90f)
                            postScale(-1f, 1f)
                        }
                        ExifInterface.ORIENTATION_ROTATE_270 -> postRotate(-90f)
                    }
                }
        }
    }
