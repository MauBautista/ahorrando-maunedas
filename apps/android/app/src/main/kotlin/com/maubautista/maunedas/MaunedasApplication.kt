package com.maubautista.maunedas

import android.app.Application
import androidx.hilt.work.HiltWorkerFactory
import androidx.lifecycle.ProcessLifecycleOwner
import androidx.work.Configuration
import com.maubautista.maunedas.core.sync.ForegroundSync
import dagger.hilt.android.HiltAndroidApp
import javax.inject.Inject

/**
 * Root of the Hilt graph (05 §1). WorkManager is configured here with Hilt's factory (its default initializer is
 * removed in the manifest), and the foreground sync follows the process lifecycle (04 §6.6).
 */
@HiltAndroidApp
class MaunedasApplication :
    Application(),
    Configuration.Provider {
    @Inject lateinit var workerFactory: HiltWorkerFactory

    @Inject lateinit var foregroundSync: ForegroundSync

    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder().setWorkerFactory(workerFactory).build()

    override fun onCreate() {
        super.onCreate()
        ProcessLifecycleOwner.get().lifecycle.addObserver(foregroundSync)
    }
}
