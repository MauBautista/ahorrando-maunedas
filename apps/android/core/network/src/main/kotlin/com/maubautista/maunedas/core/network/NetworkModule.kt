package com.maubautista.maunedas.core.network

import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import java.util.concurrent.TimeUnit
import javax.inject.Singleton

/** Retrofit over OkHttp; the app provides [ApiConfig], [ClientInfo] and [IdTokenProvider]. */
@Module
@InstallIn(SingletonComponent::class)
object NetworkModule {
    @Provides
    fun json(): Json = MaunedasJson

    @Provides
    @Singleton
    fun okHttp(
        auth: AuthInterceptor,
        authenticator: TokenAuthenticator,
    ): OkHttpClient = buildOkHttp(auth, authenticator)

    @Provides
    @Singleton
    fun api(
        config: ApiConfig,
        client: OkHttpClient,
        json: Json,
    ): MaunedasApi = buildApi(config, client, json)
}

internal fun buildOkHttp(
    auth: AuthInterceptor,
    authenticator: TokenAuthenticator,
): OkHttpClient =
    OkHttpClient.Builder()
        .addInterceptor(auth)
        .authenticator(authenticator)
        .connectTimeout(15, TimeUnit.SECONDS)
        // Uploads of up to 15 MB on a slow mobile connection (10 §4.1).
        .writeTimeout(120, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .build()

internal fun buildApi(
    config: ApiConfig,
    client: OkHttpClient,
    json: Json,
): MaunedasApi =
    Retrofit.Builder()
        .baseUrl(config.retrofitBaseUrl)
        .client(client)
        .addCallAdapterFactory(ApiErrorCallAdapterFactory(json))
        .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
        .build()
        .create(MaunedasApi::class.java)
