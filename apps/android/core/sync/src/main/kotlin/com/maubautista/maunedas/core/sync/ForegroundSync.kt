package com.maubautista.maunedas.core.sync

import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

/**
 * While the app is visible, one more sync every 60 s (04 §6.6), so changes from other devices show up
 * without waiting for the periodic one. Registered on `ProcessLifecycleOwner` by the app.
 */
@Singleton
class ForegroundSync
    @Inject
    constructor(
        private val scheduler: SyncScheduler,
    ) : DefaultLifecycleObserver {
        private var loop: Job? = null

        override fun onStart(owner: LifecycleOwner) {
            loop?.cancel()
            loop =
                owner.lifecycleScope.launch {
                    while (isActive) {
                        scheduler.syncNow()
                        delay(INTERVAL_MS)
                    }
                }
        }

        override fun onStop(owner: LifecycleOwner) {
            loop?.cancel()
            loop = null
        }

        private companion object {
            const val INTERVAL_MS = 60_000L
        }
    }
