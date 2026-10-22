package com.maubautista.maunedas.core.auth

import android.app.Activity
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.gms.tasks.Tasks
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.firebase.FirebaseNetworkException
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseAuthInvalidCredentialsException
import com.google.firebase.auth.FirebaseAuthInvalidUserException
import com.google.firebase.auth.GoogleAuthProvider
import com.maubautista.maunedas.core.model.Usernames
import com.maubautista.maunedas.core.network.IdTokenProvider
import kotlinx.coroutines.tasks.await
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Named
import javax.inject.Singleton

/** What the login screen needs; implemented with Firebase, faked in tests. */
interface AuthService {
    /** A Firebase user and a saved session: the app can open offline (RF-AUTH-08). */
    suspend fun isSignedIn(): Boolean

    suspend fun signInWithPassword(
        username: String,
        password: String,
    ): LoginResult

    suspend fun signInWithGoogle(activity: Activity): LoginResult

    /** Rows and binaries that would be lost by signing out now (02 §6.4). */
    suspend fun pendingChanges(): Int

    suspend fun signOut()
}

/** Firebase Auth with the synthetic e-mail (02 §3) or Google through Credential Manager (02 §6.2). */
@Singleton
class FirebaseAuthService
    @Inject
    constructor(
        private val auth: FirebaseAuth,
        private val finisher: LoginFinisher,
        private val session: SessionStore,
        private val cleaner: SignOutCleaner,
        @Named("syntheticEmailDomain") private val emailDomain: String,
        @Named("googleWebClientId") private val webClientId: String,
    ) : AuthService {
        override suspend fun isSignedIn(): Boolean = auth.currentUser != null && session.current() != null

        override suspend fun signInWithPassword(
            username: String,
            password: String,
        ): LoginResult {
            val email = runCatching { Usernames.syntheticEmail(username, emailDomain) }.getOrElse { return LoginResult.InvalidCredentials }
            try {
                auth.signInWithEmailAndPassword(email, password).await()
            } catch (e: FirebaseAuthInvalidUserException) {
                return if (e.errorCode == "ERROR_USER_DISABLED") LoginResult.Disabled else LoginResult.InvalidCredentials
            } catch (e: FirebaseAuthInvalidCredentialsException) {
                // With e-mail enumeration protection a missing user and a wrong password look the same (02 §7).
                return LoginResult.InvalidCredentials
            } catch (e: FirebaseNetworkException) {
                return LoginResult.NoNetwork
            }
            return finisher.finish { auth.signOut() }
        }

        override suspend fun signInWithGoogle(activity: Activity): LoginResult {
            if (webClientId.isBlank()) return LoginResult.Error(IllegalStateException("GOOGLE_WEB_CLIENT_ID vacío"))
            val request =
                GetCredentialRequest.Builder().addCredentialOption(GetSignInWithGoogleOption.Builder(webClientId).build()).build()
            val credential =
                try {
                    CredentialManager.create(activity).getCredential(activity, request).credential
                } catch (e: GetCredentialCancellationException) {
                    return LoginResult.Cancelled
                } catch (e: NoCredentialException) {
                    return LoginResult.Error(e)
                }
            if (credential !is CustomCredential || credential.type != GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
                return LoginResult.Error(IllegalStateException("Credencial inesperada"))
            }
            val idToken = GoogleIdTokenCredential.createFrom(credential.data).idToken
            try {
                auth.signInWithCredential(GoogleAuthProvider.getCredential(idToken, null)).await()
            } catch (e: FirebaseAuthInvalidUserException) {
                return if (e.errorCode == "ERROR_USER_DISABLED") LoginResult.Disabled else LoginResult.Error(e)
            } catch (e: FirebaseNetworkException) {
                return LoginResult.NoNetwork
            }
            return finisher.finish { auth.signOut() }
        }

        override suspend fun pendingChanges(): Int = cleaner.pendingChanges()

        override suspend fun signOut() = cleaner.signOut { auth.signOut() }
    }

/** The ID token of the Firebase user for every API request (02 §6.3). */
class FirebaseIdTokenProvider
    @Inject
    constructor(
        private val auth: FirebaseAuth,
    ) : IdTokenProvider {
        override fun idToken(forceRefresh: Boolean): String? {
            val user = auth.currentUser ?: return null
            return Tasks.await(user.getIdToken(forceRefresh), 20, TimeUnit.SECONDS).token
        }
    }
