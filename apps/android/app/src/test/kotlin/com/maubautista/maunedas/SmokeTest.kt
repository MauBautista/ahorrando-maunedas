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
        assertEquals("https://maunedas-dev.maunedas.workers.dev", BuildConfig.API_BASE_URL)
        assertTrue(BuildConfig.APPLICATION_ID.endsWith(".dev"))
    }

    @Test
    fun authSettingsComeFromTheBuild() {
        assertEquals("maunedas.local", BuildConfig.SYNTHETIC_EMAIL_DOMAIN)
        // Empty until T-004 sets maunedas.googleWebClientId.dev; then it is an OAuth client id.
        assertTrue(
            BuildConfig.GOOGLE_WEB_CLIENT_ID.isEmpty() ||
                BuildConfig.GOOGLE_WEB_CLIENT_ID.endsWith(".apps.googleusercontent.com"),
        )
    }
}
