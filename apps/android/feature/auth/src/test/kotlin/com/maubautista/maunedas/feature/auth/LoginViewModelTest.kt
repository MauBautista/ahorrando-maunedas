package com.maubautista.maunedas.feature.auth

import android.app.Activity
import com.maubautista.maunedas.core.auth.AuthService
import com.maubautista.maunedas.core.auth.LoginResult
import com.maubautista.maunedas.core.auth.SessionUser
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class LoginViewModelTest {
    private class FakeAuth : AuthService {
        var next: CompletableDeferred<LoginResult> = CompletableDeferred()
        val passwordCalls = mutableListOf<Pair<String, String>>()

        override suspend fun isSignedIn() = false

        override suspend fun signInWithPassword(
            username: String,
            password: String,
        ): LoginResult {
            passwordCalls += username to password
            return next.await()
        }

        override suspend fun signInWithGoogle(activity: Activity) = next.await()

        override suspend fun pendingChanges() = 0

        override suspend fun signOut() = Unit

        override suspend fun changePassword(
            current: String,
            new: String,
        ) = com.maubautista.maunedas.core.auth.PasswordChange.DONE

        override fun signedInWithPassword() = true
    }

    private val auth = FakeAuth()
    private var syncStarts = 0
    private lateinit var vm: LoginViewModel

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        vm = LoginViewModel(auth) { syncStarts++ }
    }

    @After
    fun tearDown() = Dispatchers.resetMain()

    @Test
    fun emptyFieldsAskForUsernameAndPasswordWithoutCallingFirebase() {
        vm.signInWithPassword()
        assertEquals(R.string.auth_error_empty, vm.state.value.error)
        assertTrue(auth.passwordCalls.isEmpty())
    }

    @Test
    fun aSuccessfulLoginStartsSyncAndGoesHome() =
        runTest {
            vm.onUsernameChange("mau")
            vm.onPasswordChange("secreta123")
            val event = backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { vm.signedIn.first() }
            vm.signInWithPassword()
            assertTrue(vm.state.value.busy)
            auth.next.complete(LoginResult.Success(SessionUser("u", "mau", "Mauricio", "admin", true)))
            assertTrue(event.isCompleted)
            assertEquals(1, syncStarts)
            assertFalse(vm.state.value.busy)
            assertEquals("", vm.state.value.password)
            assertEquals(listOf("mau" to "secreta123"), auth.passwordCalls)
        }

    @Test
    fun eachFailureShowsItsMessageAndKeepsWhatWasTyped() {
        val expected =
            mapOf(
                LoginResult.InvalidCredentials to R.string.auth_error_invalid,
                LoginResult.NotAllowed to R.string.auth_error_not_allowed,
                LoginResult.Disabled to R.string.auth_error_disabled,
                LoginResult.NoNetwork to R.string.auth_error_no_network,
                LoginResult.Error(RuntimeException()) to R.string.auth_error_other,
            )
        for ((result, message) in expected) {
            auth.next = CompletableDeferred(result)
            vm.onUsernameChange("mau")
            vm.onPasswordChange("mala")
            vm.signInWithPassword()
            assertEquals("$result", message, vm.state.value.error)
            assertEquals("mala", vm.state.value.password)
        }
        assertEquals(0, syncStarts)
    }

    @Test
    fun aCancelledGoogleSheetIsNotAnError() {
        assertNull(LoginViewModel.messageOf(LoginResult.Cancelled))
    }

    @Test
    fun typingClearsTheError() {
        vm.signInWithPassword()
        vm.onUsernameChange("m")
        assertNull(vm.state.value.error)
    }
}
