package com.maubautista.maunedas.core.network

import com.maubautista.maunedas.core.network.dto.BarcodeLookup
import com.maubautista.maunedas.core.network.dto.BlobResponse
import com.maubautista.maunedas.core.network.dto.DeviceRegistration
import com.maubautista.maunedas.core.network.dto.ImportImageRequest
import com.maubautista.maunedas.core.network.dto.MeResponse
import com.maubautista.maunedas.core.network.dto.MergeRequest
import com.maubautista.maunedas.core.network.dto.MergeResponse
import com.maubautista.maunedas.core.network.dto.PullRequest
import com.maubautista.maunedas.core.network.dto.PullResponse
import com.maubautista.maunedas.core.network.dto.PushRequest
import com.maubautista.maunedas.core.network.dto.PushResponse
import okhttp3.RequestBody
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Path

/**
 * The Worker routes Android uses in E1 (03). WorkManager workers call them, and so do the few screens that need
 * the server at once: login, barcode lookup and the admin merge (05 §3, CLAUDE.md rule 12). Errors arrive as
 * [ApiException]. Receipt extraction joins with T-040.
 */
interface MaunedasApi {
    @GET("v1/me")
    suspend fun me(): MeResponse

    @POST("v1/devices")
    suspend fun registerDevice(
        @Body body: DeviceRegistration,
    )

    @DELETE("v1/devices/{deviceId}")
    suspend fun unregisterDevice(
        @Path("deviceId") deviceId: String,
    )

    @POST("v1/sync/push")
    suspend fun push(
        @Body body: PushRequest,
    ): PushResponse

    @POST("v1/sync/pull")
    suspend fun pull(
        @Body body: PullRequest,
    ): PullResponse

    @GET("v1/barcodes/{code}")
    suspend fun barcode(
        @Path("code") code: String,
    ): BarcodeLookup

    /** The body carries the Content-Type of the extension and its exact length (10 §4.1). */
    @PUT("v1/images/{imageId}/blobs/{name}")
    suspend fun uploadBlob(
        @Path("imageId") imageId: String,
        @Path("name") name: String,
        @Body body: RequestBody,
    ): BlobResponse

    @POST("v1/images/{imageId}/import")
    suspend fun importImage(
        @Path("imageId") imageId: String,
        @Body body: ImportImageRequest,
    ): BlobResponse

    /** Admin only; the moved rows arrive by pull afterwards (04 §3.4). */
    @POST("v1/admin/merge")
    suspend fun merge(
        @Body body: MergeRequest,
    ): MergeResponse
}
