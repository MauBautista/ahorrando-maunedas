package com.maubautista.maunedas.feature.catalog

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import com.maubautista.maunedas.core.camera.PhotoCutout
import com.maubautista.maunedas.core.camera.SubjectCutter
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.first
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

/** "Sin fondo" in S-09 over the real cut and files, with a cutter that keeps the photo's middle. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class CutoutSwitchTest {
    @get:Rule val folder = TemporaryFolder()

    private class FakeCutter(
        var ready: Boolean = true,
        var finds: Boolean = true,
    ) : SubjectCutter {
        var prepared = 0

        /** When set, a cut waits for it (after saying it [started]): a photo can change in the meantime. */
        var gate: CompletableDeferred<Unit>? = null
        var started = CompletableDeferred<Unit>()
        var cancelled = false

        override suspend fun isReady() = ready

        override fun prepare() {
            prepared++
        }

        override suspend fun cut(bitmap: Bitmap): Bitmap? {
            started.complete(Unit)
            try {
                gate?.await()
            } catch (e: CancellationException) {
                cancelled = true
                throw e
            }
            if (!finds) return null
            return Bitmap.createBitmap(bitmap.width, bitmap.height, Bitmap.Config.ARGB_8888).also {
                Canvas(it).drawRect(Rect(bitmap.width / 4, bitmap.height / 4, bitmap.width * 3 / 4, bitmap.height * 3 / 4), Paint().apply { color = Color.GREEN })
            }
        }
    }

    private var scratches = 0

    private fun photo(name: String): String =
        folder.newFile(name).also { f ->
            val b = Bitmap.createBitmap(400, 300, Bitmap.Config.ARGB_8888).apply { eraseColor(Color.GRAY) }
            f.outputStream().use { b.compress(Bitmap.CompressFormat.JPEG, 85, it) }
        }.path

    private fun kotlinx.coroutines.CoroutineScope.switch(cutter: FakeCutter) = CutoutSwitch(PhotoCutout(cutter), { File(folder.root, "cut-${scratches++}") }, this)

    @Test
    fun withoutTheModelItWaitsAndAsksForIt() =
        runTest {
            val cutter = FakeCutter(ready = false)
            val switch = switch(cutter)
            switch.offer(photo("a.jpg"))
            assertEquals(CutoutUi(ready = false), switch.state.first { it != null })
            assertEquals(1, cutter.prepared)
            switch.toggle(true)
            assertEquals(CutoutUi(ready = false), switch.state.value)
            assertNull(switch.toSave())
        }

    @Test
    fun onCutsTheProductAndOffDropsTheFiles() =
        runTest {
            val switch = switch(FakeCutter())
            switch.offer(photo("a.jpg"))
            assertEquals(CutoutUi(ready = true), switch.state.first { it != null })
            assertNull(switch.toSave())
            switch.toggle(true)
            assertEquals(true, switch.state.value?.working)
            val on = switch.state.first { it?.files != null }!!
            assertEquals(listOf(true, false, false), listOf(on.on, on.working, on.notFound))
            val files = switch.toSave()!!
            assertEquals(listOf(232, 256, 232), listOf(files.processed.width, files.thumb.width, files.mask.width))
            assertTrue(listOf(files.processed, files.thumb, files.mask).all { File(it.path).isFile })
            // Turning it on again does nothing; off deletes the cut and saves the photo whole.
            switch.toggle(true)
            assertEquals(files, switch.toSave())
            switch.toggle(false)
            assertEquals(CutoutUi(ready = true), switch.state.value)
            assertNull(switch.toSave())
            assertTrue(!File(files.processed.path).parentFile!!.exists())
        }

    @Test
    fun aPhotoWithoutAProductIsSavedWhole() =
        runTest {
            val switch = switch(FakeCutter(finds = false))
            switch.offer(photo("a.jpg"))
            switch.state.first { it != null }
            switch.toggle(true)
            assertEquals(CutoutUi(ready = true, notFound = true), switch.state.first { it?.notFound == true })
            assertNull(switch.toSave())
            assertTrue(!File(folder.root, "cut-0").exists())
        }

    @Test
    fun anotherPhotoOrLeavingDropsTheCut() =
        runTest {
            val cutter = FakeCutter()
            val switch = switch(cutter)
            switch.offer(photo("a.jpg"))
            switch.state.first { it != null }
            switch.toggle(true)
            val first = switch.state.first { it?.files != null }!!.files!!
            // A new photo starts off and takes the old cut away.
            switch.offer(photo("b.jpg"))
            assertEquals(CutoutUi(ready = true), switch.state.first { it != null })
            assertTrue(!File(first.processed.path).exists())
            // A cut still running when the photo changes is cancelled, so its result never lands on the new one.
            cutter.gate = CompletableDeferred()
            cutter.started = CompletableDeferred()
            switch.toggle(true)
            cutter.started.await()
            switch.offer(photo("c.jpg"))
            testScheduler.advanceUntilIdle()
            assertTrue(cutter.cancelled)
            cutter.gate!!.complete(Unit)
            assertEquals(CutoutUi(ready = true), switch.state.first { it != null })
            assertNull(switch.toSave())
            // Leaving clears it.
            switch.clear()
            assertNull(switch.state.value)
        }
}
