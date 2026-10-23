package com.maubautista.maunedas.core.sync

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class SyncStatusStoreTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()

    @Test
    fun theLastSuccessOutlivesTheProcessAndSigningOutForgetsIt() {
        val first = SyncStatusStore(context)
        assertEquals(SyncStatus.Idle, first.status.value)
        first.set(SyncStatus.Synced(1_000))
        // A failure afterwards shows now, but the last success is what a new process remembers.
        first.set(SyncStatus.Failed(2_000, "NETWORK"))
        assertEquals(SyncStatus.Synced(1_000), SyncStatusStore(context).status.value)
        first.clear()
        assertEquals(SyncStatus.Idle, first.status.value)
        assertEquals(SyncStatus.Idle, SyncStatusStore(context).status.value)
    }
}
