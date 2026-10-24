package com.maubautista.maunedas

import coil3.annotation.ExperimentalCoilApi
import coil3.network.CacheStrategy
import coil3.network.NetworkRequest
import coil3.network.NetworkResponse
import coil3.request.Options

/**
 * Coil's disk cache keeps photos only. A photo can be asked for before it is on the server (an open catalog import
 * still running, or a row that arrived before its blob): its 404 is not kept, so the next look asks again. A Galaxy
 * A53 kept that 404 and showed the initial for good (T-117). A non-photo already cached is read past, too.
 */
@OptIn(ExperimentalCoilApi::class)
object PhotoCacheStrategy : CacheStrategy {
    override suspend fun read(
        cacheResponse: NetworkResponse,
        networkRequest: NetworkRequest,
        options: Options,
    ): CacheStrategy.ReadResult =
        if (cacheResponse.code in OK) CacheStrategy.DEFAULT.read(cacheResponse, networkRequest, options) else CacheStrategy.ReadResult(networkRequest)

    override suspend fun write(
        cacheResponse: NetworkResponse?,
        networkRequest: NetworkRequest,
        networkResponse: NetworkResponse,
        options: Options,
    ): CacheStrategy.WriteResult =
        if (networkResponse.code in OK) CacheStrategy.DEFAULT.write(cacheResponse, networkRequest, networkResponse, options) else CacheStrategy.WriteResult.DISABLED

    private val OK = 200..299
}
