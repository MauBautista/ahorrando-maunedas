package com.maubautista.maunedas.core.camera

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ScanCodesTest {
    @Test
    fun onlyProductCodesSurvive() {
        assertEquals("7501020515343", ScanCodes.normalize("7501020515343"))
        assertEquals("7501020515343", ScanCodes.normalize("750-1020 515343"))
        // EAN-8 and UPC-E are short but valid; a Code 128 with letters or a long tracking number are not.
        assertEquals("12345670", ScanCodes.normalize("12345670"))
        assertNull(ScanCodes.normalize("ABC-12345"))
        assertNull(ScanCodes.normalize("12345"))
        assertNull(ScanCodes.normalize("123456789012345"))
    }

    @Test
    fun theSameCodeIsIgnoredForTwoSecondsWhileTheCameraKeepsSeeingIt() {
        val gate = ScanGate()
        // Two reads confirm it.
        assertFalse(gate.accept("111111", 0))
        assertTrue(gate.accept("111111", 30))
        assertFalse(gate.accept("111111", 500))
        // Still in view: each read pushes the quiet time.
        assertFalse(gate.accept("111111", 2_400))
        assertFalse(gate.accept("111111", 4_500))
        assertTrue(gate.accept("111111", 4_530))
        // Another code counts once confirmed, and so does going back to the first.
        assertFalse(gate.accept("222222", 4_600))
        assertTrue(gate.accept("222222", 4_630))
        assertFalse(gate.accept("111111", 4_700))
        assertTrue(gate.accept("111111", 4_730))
    }

    @Test
    fun aCodeReadInOneFrameOnlyIsAMisread() {
        val gate = ScanGate()
        // Seen on a Galaxy A53 in low light: a label read as other codes for one frame each, between good reads.
        assertFalse(gate.accept("7503006698316", 0))
        assertFalse(gate.accept("4513466698316", 30))
        assertFalse(gate.accept("4597466698316", 60))
        assertTrue(gate.accept("7503006698316", 90))
        // The misreads never come back, so they never count.
        assertFalse(gate.accept("4513466698316", 1_200))
        assertFalse(gate.accept("4597466698316", 2_400))
        // Two reads too far apart are two misreads, not a confirmation.
        assertFalse(gate.accept("12345670", 5_000))
        assertFalse(gate.accept("12345670", 6_100))
    }
}
