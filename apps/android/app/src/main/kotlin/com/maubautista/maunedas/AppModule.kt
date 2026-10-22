package com.maubautista.maunedas

import com.maubautista.maunedas.core.model.Clock
import com.maubautista.maunedas.core.network.ApiConfig
import com.maubautista.maunedas.core.network.ClientInfo
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Named

/** What only the app knows: its flavor's BuildConfig (05 §1). */
@Module
@InstallIn(SingletonComponent::class)
object AppModule {
    /** The sync schema this build understands (04 §5); raise it with an incompatible change. */
    private const val CLIENT_SCHEMA = 1

    @Provides
    fun apiConfig() = ApiConfig(BuildConfig.API_BASE_URL)

    @Provides
    fun clientInfo() = ClientInfo(schema = CLIENT_SCHEMA, appVersion = BuildConfig.VERSION_NAME)

    @Provides
    fun clock(): Clock = Clock.SYSTEM

    @Provides
    @Named("syntheticEmailDomain")
    fun syntheticEmailDomain(): String = BuildConfig.SYNTHETIC_EMAIL_DOMAIN

    @Provides
    @Named("googleWebClientId")
    fun googleWebClientId(): String = BuildConfig.GOOGLE_WEB_CLIENT_ID
}
