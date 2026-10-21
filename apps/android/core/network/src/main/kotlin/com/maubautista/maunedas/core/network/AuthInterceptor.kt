package com.maubautista.maunedas.core.network

import okhttp3.Authenticator
import okhttp3.Interceptor
import okhttp3.Request
import okhttp3.Response
import okhttp3.Route
import javax.inject.Inject

/** Adds the client headers (03 §1) and, with a signed-in user, the Firebase ID token (02 §6.3). */
class AuthInterceptor
    @Inject
    constructor(
        private val tokens: IdTokenProvider,
        private val client: ClientInfo,
    ) : Interceptor {
        override fun intercept(chain: Interceptor.Chain): Response {
            val request =
                chain.request().newBuilder()
                    .header("X-Client-Schema", client.schema.toString())
                    .header("X-Client-Version", client.appVersion)
            tokens.idToken(forceRefresh = false)?.let { request.header("Authorization", "Bearer $it") }
            return chain.proceed(request.build())
        }
    }

/**
 * On a 401, asks Firebase for a fresh token and retries once (02 §6.3); a second 401 is returned as is and
 * becomes an [ApiException].
 */
class TokenAuthenticator
    @Inject
    constructor(
        private val tokens: IdTokenProvider,
    ) : Authenticator {
        override fun authenticate(
            route: Route?,
            response: Response,
        ): Request? {
            if (response.request.header(RETRY_HEADER) != null) return null
            val token = tokens.idToken(forceRefresh = true) ?: return null
            return response.request.newBuilder()
                .header("Authorization", "Bearer $token")
                .header(RETRY_HEADER, "1")
                .build()
        }

        private companion object {
            const val RETRY_HEADER = "X-Auth-Retry"
        }
    }
