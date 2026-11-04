package com.maubautista.maunedas.core.sync

import com.maubautista.maunedas.core.database.entity.ImageEntity
import com.maubautista.maunedas.core.database.entity.ImageRenditionEntity
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** 10 §6.1: a photo adopts its newest home-server result, as the Worker's `ImageRef.adopt` does. */
@RunWith(RobolectricTestRunner::class)
class HomeAdoptionTest {
    private val env = TestEnv()
    private val adoption = HomeAdoption(env.db, env.writer)

    @After
    fun close() = env.close()

    private fun image(
        id: String,
        editParams: String? = null,
        deletedAt: Long? = null,
    ) = ImageEntity(
        id = id, ownerType = "product", ownerId = "p1", role = "catalog", source = "user", originalKey = "images/$id/original.jpg",
        editParams = editParams, createdAt = 1, updatedAt = 1, deletedAt = deletedAt,
    )

    private fun rendition(
        id: String,
        image: String,
        kind: String,
        createdAt: Long,
        tier: String = "home",
        deletedAt: Long? = null,
    ) = ImageRenditionEntity(
        id = id, imageId = image, kind = kind, tier = tier, r2Key = "images/$image/$id.webp", createdAt = createdAt, updatedAt = createdAt, deletedAt = deletedAt,
    )

    @Test
    fun selectsTheNewestHomeProcessedAndThumb() =
        runTest {
            env.db.images().upsertAll(listOf(image("i1")))
            env.db.imageRenditions().upsertAll(
                listOf(
                    rendition("p-old", "i1", "processed", 10),
                    rendition("t-old", "i1", "thumb", 10),
                    // Same time: the greater id wins, as the Worker orders them.
                    rendition("p-b", "i1", "processed", 20),
                    rendition("p-a", "i1", "processed", 20),
                    rendition("t-new", "i1", "thumb", 20),
                    // Not home, or deleted: never chosen.
                    rendition("p-device", "i1", "processed", 30, tier = "device"),
                    rendition("t-gone", "i1", "thumb", 40, deletedAt = 41),
                ),
            )
            assertEquals(1, adoption.adopt(listOf("i1", "i1")))
            val adopted = env.db.images().byId("i1")!!
            assertEquals(listOf("p-b", "t-new"), listOf(adopted.selectedProcessedId, adopted.selectedThumbId))
            // It is an edit by sync, and once selected there is nothing more to do.
            assertEquals(1, env.db.outbox().count())
            assertEquals(0, adoption.adopt(listOf("i1")))
        }

    @Test
    fun leavesAloneEditedDeletedAndHalfDonePhotos() =
        runTest {
            env.db.images().upsertAll(listOf(image("manual", """{"manual":true}"""), image("gone", deletedAt = 5), image("half"), image("auto", """{"manual":false}""")))
            env.db.imageRenditions().upsertAll(
                listOf(
                    rendition("pm", "manual", "processed", 10),
                    rendition("tm", "manual", "thumb", 10),
                    rendition("pg", "gone", "processed", 10),
                    rendition("tg", "gone", "thumb", 10),
                    // A processed without its thumb yet waits.
                    rendition("ph", "half", "processed", 10),
                    rendition("pa", "auto", "processed", 10),
                    rendition("ta", "auto", "thumb", 10),
                ),
            )
            assertEquals(1, adoption.adopt(listOf("manual", "gone", "half", "auto", "unknown")))
            assertEquals("pa", env.db.images().byId("auto")!!.selectedProcessedId)
            assertEquals(null, env.db.images().byId("half")!!.selectedProcessedId)
            assertTrue(HomeAdoption.manual("""{"crop":{},"manual":true}"""))
            assertFalse(HomeAdoption.manual("no es json"))
            assertFalse(HomeAdoption.manual(null))
        }
}
