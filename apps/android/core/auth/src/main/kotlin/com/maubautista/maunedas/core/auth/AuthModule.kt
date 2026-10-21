package com.maubautista.maunedas.core.auth

import com.google.firebase.auth.FirebaseAuth
import com.maubautista.maunedas.core.model.CurrentUser
import com.maubautista.maunedas.core.network.IdTokenProvider
import dagger.Binds
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent

@Module
@InstallIn(SingletonComponent::class)
abstract class AuthModule {
    @Binds
    abstract fun tokens(provider: FirebaseIdTokenProvider): IdTokenProvider

    @Binds
    abstract fun currentUser(session: SessionStore): CurrentUser

    @Binds
    abstract fun authService(service: FirebaseAuthService): AuthService

    companion object {
        @Provides
        fun firebaseAuth(): FirebaseAuth = FirebaseAuth.getInstance()
    }
}
