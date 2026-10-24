package com.maubautista.maunedas

import android.app.Application
import androidx.hilt.work.HiltWorkerFactory
import androidx.lifecycle.ProcessLifecycleOwner
import androidx.work.Configuration
import coil3.ImageLoader
import coil3.PlatformContext
import coil3.SingletonImageLoader
import coil3.disk.DiskCache
import coil3.network.okhttp.OkHttpNetworkFetcherFactory
import coil3.request.crossfade
import com.maubautista.maunedas.core.sync.ForegroundSync
import dagger.hilt.android.HiltAndroidApp
import javax.inject.Inject
import okhttp3.OkHttpClient
import okio.Path.Companion.toOkioPath

/**
 * Root of the Hilt graph (05 §1). WorkManager is configured here with Hilt's factory (its default initializer is
 * removed in the manifest), and the foreground sync follows the process lifecycle (04 §6.6). Coil loads product
 * photos with the API's HTTP client, so `/v1/images/…` carries the session (05 §1).
 */
@HiltAndroidApp
class MaunedasApplication :
    Application(),
    Configuration.Provider,
    SingletonImageLoader.Factory {
    @Inject lateinit var workerFactory: HiltWorkerFactory

    @Inject lateinit var foregroundSync: ForegroundSync

    @Inject lateinit var http: dagger.Lazy<OkHttpClient>

    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder().setWorkerFactory(workerFactory).build()

    override fun onCreate() {
        super.onCreate()
        ProcessLifecycleOwner.get().lifecycle.addObserver(foregroundSync)
    }

    override fun newImageLoader(context: PlatformContext): ImageLoader =
        ImageLoader.Builder(context)
            .components { add(OkHttpNetworkFetcherFactory(callFactory = { http.get() }, cacheStrategy = { PhotoCacheStrategy })) }
            // Blobs never change (10 §1: immutable keys), so what was seen once stays on the phone.
            .diskCache { DiskCache.Builder().directory(cacheDir.resolve("photos").toOkioPath()).maxSizeBytes(PHOTO_CACHE_BYTES).build() }
            .crossfade(true)
            .build()

    private companion object {
        const val PHOTO_CACHE_BYTES = 100L * 1024 * 1024
    }
}
