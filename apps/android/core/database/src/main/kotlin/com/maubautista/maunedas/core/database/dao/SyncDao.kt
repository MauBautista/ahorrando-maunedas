package com.maubautista.maunedas.core.database.dao

import androidx.room.Upsert

/** Every mirrored table: pull and local writes upsert whole rows by primary key. */
interface SyncDao<T> {
    @Upsert
    suspend fun upsertAll(rows: List<T>)
}
