package com.maubautista.maunedas.core.auth

import android.content.Context
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStoreFile
import com.maubautista.maunedas.core.model.CurrentUser
import com.maubautista.maunedas.core.network.dto.MeUser
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import javax.inject.Inject
import javax.inject.Singleton

/** The signed-in user as the app keeps it, so the app opens without network (RF-AUTH-08, 02 §6.4). */
data class SessionUser(val id: String, val username: String, val displayName: String, val role: String, val hasGoogle: Boolean) {
    val isAdmin: Boolean get() = role == "admin"
}

/** DataStore with id, username, display name and role (02 §6.2); also the [CurrentUser] of sync. */
@Singleton
class SessionStore
    @Inject
    constructor(
        @ApplicationContext context: Context,
    ) : CurrentUser {
        private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        private val store = PreferenceDataStoreFactory.create(scope = scope) { context.preferencesDataStoreFile(FILE) }

        val user: StateFlow<SessionUser?> = store.data.map(::toUser).stateIn(scope, SharingStarted.Eagerly, null)

        private fun toUser(p: Preferences): SessionUser? {
            val id = p[ID] ?: return null
            return SessionUser(id, p[USERNAME].orEmpty(), p[DISPLAY_NAME].orEmpty(), p[ROLE] ?: "member", p[HAS_GOOGLE] ?: false)
        }

        /** Null until the store is read and without a session; sync then simply waits (SyncWorker). */
        override fun id(): String? = user.value?.id

        /** Reads the store itself: [user] starts at null before the first read. */
        suspend fun current(): SessionUser? = toUser(store.data.first())

        suspend fun save(me: MeUser) {
            store.edit {
                it[ID] = me.id
                it[USERNAME] = me.username
                it[DISPLAY_NAME] = me.displayName
                it[ROLE] = me.role
                it[HAS_GOOGLE] = me.hasGoogle
            }
        }

        suspend fun clear() {
            store.edit { it.clear() }
        }

        private companion object {
            const val FILE = "session"
            val ID = stringPreferencesKey("id")
            val USERNAME = stringPreferencesKey("username")
            val DISPLAY_NAME = stringPreferencesKey("display_name")
            val ROLE = stringPreferencesKey("role")
            val HAS_GOOGLE = booleanPreferencesKey("has_google")
        }
    }
