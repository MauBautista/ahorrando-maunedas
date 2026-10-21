package com.maubautista.maunedas.core.network

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import retrofit2.Response

/**
 * An error answered by the Worker (03 §1.1). The UI decides by [code]; [message] is in Spanish and can be
 * shown. A body that is not the Worker's error format (a proxy page, a timeout page) gets code `HTTP_ERROR`.
 */
open class ApiException(
    val status: Int,
    val code: String,
    message: String,
    val details: JsonObject? = null,
    val requestId: String? = null,
) : Exception(message)

/** `426 UPGRADE_REQUIRED`: the app is older than the server's `MIN_CLIENT_SCHEMA` (04 §5). */
class UpgradeRequiredException(message: String, requestId: String?) :
    ApiException(426, "UPGRADE_REQUIRED", message, requestId = requestId)

@Serializable
private data class ErrorEnvelope(val error: ErrorBody)

@Serializable
private data class ErrorBody(
    val code: String,
    val message: String,
    val details: JsonObject? = null,
    val requestId: String? = null,
)

internal object ApiErrors {
    private const val FALLBACK_MESSAGE = "Ocurrió un error inesperado."

    fun from(
        response: Response<*>,
        json: Json,
    ): ApiException {
        val raw = runCatching { response.errorBody()?.string() }.getOrNull()
        val body = raw?.let { runCatching { json.decodeFromString(ErrorEnvelope.serializer(), it).error }.getOrNull() }
        val requestId = body?.requestId ?: response.headers()["X-Request-Id"]
        return when {
            body == null -> ApiException(response.code(), "HTTP_ERROR", FALLBACK_MESSAGE, requestId = requestId)
            body.code == "UPGRADE_REQUIRED" -> UpgradeRequiredException(body.message, requestId)
            else -> ApiException(response.code(), body.code, body.message, body.details, requestId)
        }
    }
}
