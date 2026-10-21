package com.maubautista.maunedas.core.network

/** Worker base URL of the flavor (`BuildConfig.API_BASE_URL`), provided by the app. */
data class ApiConfig(val baseUrl: String) {
    init {
        require(baseUrl.startsWith("https://") || baseUrl.startsWith("http://")) { "API_BASE_URL inválida: $baseUrl" }
    }

    /** Retrofit needs the trailing slash; routes are relative (`v1/me`). */
    val retrofitBaseUrl: String get() = if (baseUrl.endsWith("/")) baseUrl else "$baseUrl/"
}

/**
 * Sent on every request (03 §1): `X-Client-Schema` (the local schema the app understands; the Worker answers
 * `426 UPGRADE_REQUIRED` below `MIN_CLIENT_SCHEMA`) and `X-Client-Version`.
 */
data class ClientInfo(val schema: Int, val appVersion: String)

/**
 * The signed-in user's Firebase ID token, or null when nobody is signed in. `core:auth` implements it with
 * FirebaseAuth (T-110). Blocking: OkHttp calls it on its own threads.
 */
interface IdTokenProvider {
    fun idToken(forceRefresh: Boolean): String?
}
