package com.maubautista.maunedas.core.camera

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Rect
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.GraphicsMode

/** 10 §5's post-processing on real pixels. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ProductImageRendererTest {
    @get:Rule val folder = TemporaryFolder()

    /** A transparent [w] × [h] picture with an opaque red [subject]. */
    private fun cut(
        w: Int,
        h: Int,
        subject: Rect,
    ) = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888).also { b ->
        Canvas(b).drawRect(subject, android.graphics.Paint().apply { color = Color.RED })
    }

    @Test
    fun cropsToTheSubjectAndCentersItOnASquareWithAnEightPercentMargin() {
        val r = ProductImageRenderer.render(cut(400, 300, Rect(100, 50, 300, 150)))!!
        // 200 × 100 with 16 px on each side of its longer side: 232 px, the subject at (16, 66)–(216, 166).
        assertEquals(listOf(232, 232), listOf(r.processed.width, r.processed.height))
        val p = r.processed
        assertEquals(Color.RED, p.getPixel(116, 116))
        assertEquals(0, Color.alpha(p.getPixel(0, 0)))
        assertEquals(listOf(0, 255), listOf(Color.alpha(p.getPixel(14, 116)), Color.alpha(p.getPixel(17, 116))))
        assertEquals(listOf(0, 255), listOf(Color.alpha(p.getPixel(116, 64)), Color.alpha(p.getPixel(116, 67))))
        assertEquals(listOf(255, 0), listOf(Color.alpha(p.getPixel(116, 164)), Color.alpha(p.getPixel(116, 168))))
    }

    @Test
    fun theThumbIsOverWhiteAndTheMaskIsTheAlpha() {
        val r = ProductImageRenderer.render(cut(400, 300, Rect(100, 50, 300, 150)))!!
        assertEquals(listOf(256, 256), listOf(r.thumb.width, r.thumb.height))
        assertEquals(Color.WHITE, r.thumb.getPixel(2, 2))
        assertEquals(Color.RED, r.thumb.getPixel(128, 128))
        // The mask covers the whole photo it got (T106): 400 × 300, white where the subject was.
        assertEquals(listOf(400, 300), listOf(r.mask.width, r.mask.height))
        assertEquals(Color.BLACK, r.mask.getPixel(0, 0))
        assertEquals(Color.WHITE, r.mask.getPixel(200, 100))
        assertEquals(Color.BLACK, r.mask.getPixel(350, 100))
        // Another background for the thumb.
        assertEquals(Color.BLUE, ProductImageRenderer.render(cut(100, 100, Rect(40, 40, 60, 60)), Color.BLUE)!!.thumb.getPixel(1, 1))
    }

    @Test
    fun aBigSubjectEndsAt1024AndNothingVisibleIsNoCut() {
        val big = ProductImageRenderer.render(cut(3000, 2000, Rect(0, 0, 3000, 2000)))!!
        assertEquals(listOf(1024, 1024), listOf(big.processed.width, big.processed.height))
        assertNull(ProductImageRenderer.render(Bitmap.createBitmap(50, 50, Bitmap.Config.ARGB_8888)))
        assertEquals(Rect(3, 4, 6, 9), ProductImageRenderer.opaqueBounds(cut(10, 10, Rect(3, 4, 6, 9))))
    }

    @Test
    fun writesWebpWithItsAlphaAndAPngMask() {
        val r = ProductImageRenderer.render(cut(400, 300, Rect(100, 50, 300, 150)))!!
        val webp = folder.newFile("processed.webp").also { ProductImageRenderer.writeWebp(r.processed, it) }
        val png = folder.newFile("mask.png").also { ProductImageRenderer.writePng(r.mask, it) }
        val back = BitmapFactory.decodeFile(webp.path)
        assertEquals(listOf(232, 232), listOf(back.width, back.height))
        assertEquals(0, Color.alpha(back.getPixel(0, 0)))
        assertEquals(255, Color.alpha(back.getPixel(116, 116)))
        assertEquals("RIFF", webp.readBytes().copyOfRange(0, 4).decodeToString())
        assertEquals(Color.WHITE, BitmapFactory.decodeFile(png.path).getPixel(116, 116))
    }
}
