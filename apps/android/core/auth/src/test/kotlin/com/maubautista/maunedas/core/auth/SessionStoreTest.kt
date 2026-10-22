package com.maubautista.maunedas.core.auth

import androidx.test.core.app.ApplicationProvider
import com.maubautista.maunedas.core.network.dto.MeUser
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class SessionStoreTest {
    @Test
    fun keepsTheUserForOfflineStartsAndIsTheCurrentUserOfSync() =
        runTest {
            val store = SessionStore(ApplicationProvider.getApplicationContext())
            assertNull(store.current())
            store.save(MeUser("u1", "pepe", "Pepe", "member", false))
            assertEquals(SessionUser("u1", "pepe", "Pepe", "member", false), store.current())
            assertEquals("u1", store.user.first { it != null }!!.id)
            assertEquals("u1", store.id())
            store.clear()
            assertNull(store.current())
        }
}
