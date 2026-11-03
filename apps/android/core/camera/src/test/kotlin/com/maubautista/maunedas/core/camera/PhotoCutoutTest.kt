package com.maubautista.maunedas.core.camera

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.GraphicsMode
import java.io.File

/** "Sin fondo" from a reduced photo to its three files, with a cutter that keeps the photo's middle. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class PhotoCutoutTest {
    @get:Rule val folder = TemporaryFolder()

    private class FakeCutter(
        var ready: Boolean = true,
        var finds: Boolean = true,
    ) : SubjectCutter {
        val seen = mutableListOf<Pair<Int, Int>>()
        var prepared = 0

        override suspend fun isReady() = ready

        override fun prepare() {
            prepared++
        }

        override suspend fun cut(bitmap: Bitmap): Bitmap? {
            seen += bitmap.width to bitmap.height
            if (!finds) return null
            return Bitmap.createBitmap(bitmap.width, bitmap.height, Bitmap.Config.ARGB_8888).also {
                Canvas(it).drawRect(Rect(bitmap.width / 4, bitmap.height / 4, bitmap.width * 3 / 4, bitmap.height * 3 / 4), Paint().apply { color = Color.GREEN })
            }
        }
    }

    private fun photo(
        w: Int,
        h: Int,
    ): File =
        folder.newFile("original.jpg").also { f ->
            val b = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888).apply { eraseColor(Color.GRAY) }
            f.outputStream().use { b.compress(Bitmap.CompressFormat.JPEG, 85, it) }
        }

    @Test
    fun cutsAPhotoReducedTo1024AndWritesItsThreeRenditions() =
        runTest {
            val cutter = FakeCutter()
            val out = folder.newFolder("cut")
            val files = PhotoCutout(cutter).make(photo(3000, 2000), out)!!
            // The subject is looked for at the result's size, not at the photo's: decoded at 1500 and scaled to 1024.
            assertEquals(listOf(1024 to 683), cutter.seen)
            assertEquals(listOf("mask.png", "processed.webp", "thumb.webp"), out.list()!!.sorted())
            // The middle half, 512 × 342, with its margin: 594 px square.
            assertEquals(CutFile(File(out, "processed.webp").path, 594, 594), files.processed)
            assertEquals(CutFile(File(out, "thumb.webp").path, 256, 256), files.thumb)
            assertEquals(CutFile(File(out, "mask.png").path, 594, 594), files.mask)
            assertEquals(594, BitmapFactory.decodeFile(files.processed.path).width)
        }

    @Test
    fun aPhotoOfTwiceTheSizeIsOnlySampled() =
        runTest {
            val cutter = FakeCutter()
            PhotoCutout(cutter).make(photo(2048, 1536), folder.newFolder("cut"))
            assertEquals(listOf(1024 to 768), cutter.seen)
        }

    @Test
    fun aSmallPhotoIsUsedAsItIs() =
        runTest {
            val cutter = FakeCutter()
            PhotoCutout(cutter).make(photo(600, 800), folder.newFolder("cut"))
            assertEquals(listOf(600 to 800), cutter.seen)
        }

    @Test
    fun noSubjectOrNoImageWritesNothing() =
        runTest {
            val cutter = FakeCutter(finds = false)
            val out = File(folder.root, "cut")
            assertNull(PhotoCutout(cutter).make(photo(400, 400), out))
            assertTrue(!out.exists())
            val notAPhoto = folder.newFile("notes.jpg").also { it.writeText("hola") }
            assertNull(PhotoCutout(FakeCutter()).make(notAPhoto, out))
        }

    @Test
    fun readinessAndTheModelRequestGoToTheCutter() =
        runTest {
            val cutter = FakeCutter(ready = false)
            val cutout = PhotoCutout(cutter)
            assertEquals(false, cutout.isReady())
            cutout.prepare()
            assertEquals(1, cutter.prepared)
        }
}
