package com.maubautista.maunedas.core.network.dto

import kotlinx.serialization.Serializable

/** `GET /v1/me` (03 §5). */
@Serializable
data class MeResponse(
    val user: MeUser,
    val serverTime: Long,
    val schemaVersion: Int,
    val minClientSchema: Int,
)

@Serializable
data class MeUser(
    val id: String,
    val username: String,
    val displayName: String,
    val role: String,
    val hasGoogle: Boolean,
)

/** `POST /v1/devices` (03 §5, `packages/shared/src/api/devices.ts`). */
@Serializable
data class DeviceRegistration(
    val deviceId: String,
    val platform: String = "android",
    val fcmToken: String?,
    val appVersion: String,
)
