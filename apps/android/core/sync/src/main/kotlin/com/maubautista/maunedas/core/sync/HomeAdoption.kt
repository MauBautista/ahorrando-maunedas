package com.maubautista.maunedas.core.sync

import com.maubautista.maunedas.core.database.AppDatabase
import com.maubautista.maunedas.core.database.entity.ImageEntity
import com.maubautista.maunedas.core.database.entity.ImageRenditionEntity
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import javax.inject.Inject

/**
 * The home server's results are adopted on the phone (10 §6.1, T-300): an image whose `home` renditions arrived by
 * pull selects the newest processed and thumb (by `created_at`, then id, as the Worker's `ImageRef.adopt`), unless it
 * was edited by hand. It is a normal edit by sync; two phones pick the same renditions.
 */
class HomeAdoption
    @Inject
    constructor(
        private val db: AppDatabase,
        private val writer: LocalWriter,
    ) {
        /** How many of [imageIds] changed their selection. */
        suspend fun adopt(imageIds: Collection<String>): Int {
            var adopted = 0
            for (id in imageIds.distinct()) {
                val image = db.images().byId(id)?.takeIf { it.deletedAt == null } ?: continue
                if (manual(image.editParams)) continue
                val home = db.imageRenditions().homeOf(id)
                val processed = home.newest("processed") ?: continue
                val thumb = home.newest("thumb") ?: continue
                if (processed.id == image.selectedProcessedId && thumb.id == image.selectedThumbId) continue
                writer.write(images, listOf(image.copy(selectedProcessedId = processed.id, selectedThumbId = thumb.id)))
                adopted++
            }
            return adopted
        }

        private fun List<ImageRenditionEntity>.newest(kind: String) = filter { it.kind == kind }.maxWithOrNull(compareBy({ it.createdAt }, { it.id }))

        companion object {
            private val images = SyncTables.of<ImageEntity>("images")

            /** `edit_params.manual` (10 §6.2): a photo edited by hand keeps its own result. */
            fun manual(editParams: String?): Boolean =
                editParams?.let { runCatching { Json.parseToJsonElement(it).jsonObject["manual"]?.jsonPrimitive?.booleanOrNull }.getOrNull() } == true
        }
    }
