package com.maubautista.maunedas.core.data

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import androidx.exifinterface.media.ExifInterface
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.GraphicsMode
import java.io.File

/** 10 §4.2: reduce, respecting EXIF, and keep under `filesDir/images/{id}/`. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class LocalPhotosTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val photos = LocalPhotos(context)

    /** A [width] × [height] JPEG, red on its left half, as a camera writes it with [orientation]. */
    private fun shot(
        width: Int,
        height: Int,
        orientation: Int = ExifInterface.ORIENTATION_NORMAL,
    ): File {
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888).apply { eraseColor(Color.BLUE) }
        for (x in 0 until width / 2) for (y in 0 until height) bitmap.setPixel(x, y, Color.RED)
        val file = File(context.cacheDir, "capture/${width}x$height-$orientation.jpg").apply { parentFile?.mkdirs() }
        file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.JPEG, 95, it) }
        ExifInterface(file.path).apply {
            setAttribute(ExifInterface.TAG_ORIENTATION, orientation.toString())
            saveAttributes()
        }
        return file
    }

    private fun size(file: File) = BitmapFactory.Options().apply { inJustDecodeBounds = true }.also { BitmapFactory.decodeFile(file.path, it) }.let { it.outWidth to it.outHeight }

    @Test
    fun aLargePhotoIsReducedToTheLongestSideAndTurnedUpright() =
        runTest {
            val taken = shot(4000, 3000, ExifInterface.ORIENTATION_ROTATE_90)
            val reduced = photos.reduce(taken, LocalPhotos.Size.PRODUCT)!!
            // Taken sideways: upright it is tall, and its longest side is 2048 px.
            assertEquals(1536 to 2048, size(reduced))
            assertFalse(taken.exists())
            // Turned clockwise, the red left half is now on top; no EXIF is left in the copy.
            val pixels = BitmapFactory.decodeFile(reduced.path)
            assertTrue("arriba rojo", pixels.getPixel(768, 200).let { Color.red(it) > 200 && Color.blue(it) < 60 })
            assertTrue("abajo azul", pixels.getPixel(768, 1800).let { Color.blue(it) > 200 && Color.red(it) < 60 })
            assertEquals(ExifInterface.ORIENTATION_UNDEFINED, ExifInterface(reduced.path).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_UNDEFINED))
            // A receipt goes to 1600 px; a small photo keeps its size.
            assertEquals(1600 to 1200, size(photos.reduce(shot(4000, 3000), LocalPhotos.Size.RECEIPT)!!))
            assertEquals(640 to 480, size(photos.reduce(shot(640, 480), LocalPhotos.Size.PRODUCT)!!))
        }

    @Test
    fun aFileThatIsNotAnImageGivesNothingAndTheKeptOriginalIsInItsFolder() =
        runTest {
            val junk = File(context.cacheDir, "capture/junk.jpg").apply { parentFile?.mkdirs(); writeText("not a photo") }
            assertNull(photos.reduce(junk, LocalPhotos.Size.PRODUCT))
            assertFalse(junk.exists())
            val reduced = photos.reduce(shot(320, 240), LocalPhotos.Size.PRODUCT)!!
            val kept = photos.keep("0190d7e5-0000-7000-8000-000000000001", reduced)
            assertEquals(File(context.filesDir, "images/0190d7e5-0000-7000-8000-000000000001/original.jpg"), kept)
            assertTrue(kept.length() > 0)
            assertFalse(reduced.exists())
        }
}
