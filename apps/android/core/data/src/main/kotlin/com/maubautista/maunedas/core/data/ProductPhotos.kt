package com.maubautista.maunedas.core.data

import android.content.Context
import com.maubautista.maunedas.core.database.AppDatabase
import com.maubautista.maunedas.core.network.ApiConfig
import dagger.hilt.android.qualifiers.ApplicationContext
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton

/**
 * What to show of an image (10 §1), as something Coil loads: the file on the phone when there is one, or the
 * Worker's `/v1/images/{id}/blobs/{name}` (Coil's client carries the session, 05 §1). The first blob in the order of
 * 10 §1 that is on the phone wins; otherwise the first one that exists on the server. While this phone still has the
 * image in its upload queue (an open catalog import, a photo freed before it went up) there is nothing to ask for.
 */
@Singleton
class ProductPhotos
    @Inject
    constructor(
        @ApplicationContext private val context: Context,
        private val db: AppDatabase,
        private val config: ApiConfig,
    ) {
        /** For lists: `selected_thumb` → `selected_processed` → original. */
        suspend fun thumb(imageId: String?): Any? = model(imageId, thumbFirst = true)

        /** The big photo: `selected_processed` → original. */
        suspend fun large(imageId: String?): Any? = model(imageId, thumbFirst = false)

        private suspend fun model(
            imageId: String?,
            thumbFirst: Boolean,
        ): Any? {
            val image = imageId?.let { db.images().byId(it) }?.takeIf { it.deletedAt == null } ?: return null
            suspend fun rendition(id: String?) = id?.let { db.imageRenditions().byId(it) }?.takeIf { it.deletedAt == null }?.r2Key
            val keys = listOfNotNull(if (thumbFirst) rendition(image.selectedThumbId) else null, rendition(image.selectedProcessedId), image.originalKey)
            val names = keys.map { it.substringAfterLast('/') }
            names.map { File(context.filesDir, "images/${image.id}/$it") }.firstOrNull { it.isFile }?.let { return it }
            if (db.pendingUploads().hasImage(image.id)) return null
            return names.firstOrNull()?.let { "${config.retrofitBaseUrl}v1/images/${image.id}/blobs/$it" }
        }
    }
