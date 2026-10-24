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
        assertTrue(gate.accept("111111", 0))
        assertFalse(gate.accept("111111", 500))
        // Still in view: each read pushes the quiet time.
        assertFalse(gate.accept("111111", 2_400))
        assertTrue(gate.accept("111111", 4_500))
        // Another code counts at once, and so does going back to the first.
        assertTrue(gate.accept("222222", 4_600))
        assertTrue(gate.accept("111111", 4_700))
    }
}
