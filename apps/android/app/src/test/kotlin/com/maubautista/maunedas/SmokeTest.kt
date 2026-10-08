package com.maubautista.maunedas

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SmokeTest {
    @Test
    fun appNameIsSet() {
        assertEquals("Ahorrando Maunedas", AppInfo.NAME)
    }

    @Test
    fun devFlavorTargetsDevWorker() {
        assertTrue(BuildConfig.API_BASE_URL.startsWith("https://maunedas-dev."))
    }
}
