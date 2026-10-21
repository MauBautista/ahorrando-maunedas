package com.maubautista.maunedas.core.sync

import android.content.Context
import androidx.core.content.edit
import com.maubautista.maunedas.core.model.Uuids
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/** This installation's `device_id` (push and `/v1/devices`), created once; signing out clears it (02 §6.4). */
@Singleton
class DeviceIdStore
    @Inject
    constructor(
        @ApplicationContext private val context: Context,
    ) {
        private val prefs by lazy { context.getSharedPreferences(PREFS, Context.MODE_PRIVATE) }

        @Synchronized
        fun get(): String =
            prefs.getString(KEY, null) ?: Uuids.v7().also { prefs.edit { putString(KEY, it) } }

        fun clear() = prefs.edit { remove(KEY) }

        private companion object {
            const val PREFS = "maunedas_sync"
            const val KEY = "device_id"
        }
    }
