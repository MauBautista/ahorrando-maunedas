package com.maubautista.maunedas.core.camera

import android.content.Context
import android.net.Uri
import androidx.test.core.app.ApplicationProvider
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class CopyToCaptureTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()

    @Test
    fun aPickedPhotoIsCopiedToTheCaptureFolderAndAMissingOneGivesNothing() {
        val picked = File(context.filesDir, "picked.jpg").apply { writeBytes(byteArrayOf(1, 2, 3)) }
        val copy = copyToCapture(context, Uri.fromFile(picked))!!
        assertEquals(File(context.cacheDir, "capture"), copy.parentFile)
        assertTrue(copy.readBytes().contentEquals(byteArrayOf(1, 2, 3)))
        assertNull(copyToCapture(context, Uri.fromFile(File(context.filesDir, "gone.jpg"))))
        // An empty one is not a photo, and its empty copy goes away.
        assertNull(copyToCapture(context, Uri.fromFile(File(context.filesDir, "empty.jpg").apply { writeBytes(ByteArray(0)) })))
        // Nothing is left behind for it.
        assertEquals(listOf(copy.name), File(context.cacheDir, "capture").list()!!.toList())
    }
}
