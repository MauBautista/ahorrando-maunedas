package com.maubautista.maunedas

import android.app.Application
import androidx.test.core.app.ApplicationProvider
import coil3.annotation.ExperimentalCoilApi
import coil3.network.CacheStrategy
import coil3.network.NetworkRequest
import coil3.network.NetworkResponse
import coil3.request.Options
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** T-117 on a Galaxy A53: a photo asked for before its import kept its 404 in the disk cache for good. */
@OptIn(ExperimentalCoilApi::class)
@RunWith(RobolectricTestRunner::class)
// A plain application: the strategy needs no Hilt graph.
@Config(application = Application::class)
class PhotoCacheStrategyTest {
    private val options = Options(ApplicationProvider.getApplicationContext())
    private val request = NetworkRequest("https://api.test/v1/images/i/blobs/original.jpg")

    @Test
    fun onlyPhotosAreKeptAndAnErrorAlreadyKeptIsAskedAgain() =
        runTest {
            assertEquals(CacheStrategy.WriteResult.DISABLED, PhotoCacheStrategy.write(null, request, NetworkResponse(code = 404), options))
            assertEquals(CacheStrategy.WriteResult.DISABLED, PhotoCacheStrategy.write(null, request, NetworkResponse(code = 500), options))
            val photo = NetworkResponse(code = 200)
            assertEquals(CacheStrategy.DEFAULT.write(null, request, photo, options), PhotoCacheStrategy.write(null, request, photo, options))
            // A 404 on the phone from before this fix goes to the network; a photo is read from the cache.
            assertEquals(CacheStrategy.ReadResult(request), PhotoCacheStrategy.read(NetworkResponse(code = 404), request, options))
            assertEquals(CacheStrategy.DEFAULT.read(photo, request, options), PhotoCacheStrategy.read(photo, request, options))
        }
}
