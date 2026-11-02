package com.maubautista.maunedas.core.data

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.maubautista.maunedas.core.database.AppDatabase
import com.maubautista.maunedas.core.database.entity.AgentStatusEntity
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** RF-ADM-03 from the agent's report in Room. */
@RunWith(RobolectricTestRunner::class)
class AgentStatusRepositoryTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val db = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java).allowMainThreadQueries().build()
    private val agents = AgentStatusRepository(db)

    @After
    fun close() = db.close()

    @Test
    fun readsTheLatestReportWithItsQueueStoresErrorAndBackups() =
        runTest {
            assertNull(agents.status().first())
            val info =
                """{"outbox":2,"due":5,"mem_mb":36.5,"load1":0.4,"blocked":["sams_mx","otra"],"last_error":"work: HTTP 503",
                   "backup":{"mirror_ok":true,"mirror_at":900,"mirror_rows":57,"dump_ok":false,"dump_error":"disco lleno",
                   "photos_ok":null,"photos_error":"sin credenciales de R2"}}"""
            db.agentStatus().upsertAll(
                listOf(
                    AgentStatusEntity(id = "old", lastHeartbeatAt = 10, agentVersion = "0.0.9", info = "{}", updatedAt = 1),
                    AgentStatusEntity(id = "home", lastHeartbeatAt = 1_000, agentVersion = "0.1.0", info = info, updatedAt = 1),
                ),
            )
            val a = agents.status().first()!!
            assertEquals(listOf(1_000L, "0.1.0", 5, 2, listOf("Sam’s Club", "otra"), "work: HTTP 503"), listOf(a.lastHeartbeatAt, a.version, a.due, a.outbox, a.blocked, a.lastError))
            assertEquals(BackupJob(true, 900, null, "57"), a.mirror)
            assertEquals(BackupJob(false, null, "disco lleno", null), a.dump)
            assertEquals(BackupJob(null, null, "sin credenciales de R2", null), a.photos)
        }

    @Test
    fun aPhoneWaitsHalfAnHourBeforeSayingItStopped() =
        runTest {
            db.agentStatus().upsertAll(listOf(AgentStatusEntity(id = "home", lastHeartbeatAt = 1_000, info = "not json", updatedAt = 1)))
            val a = agents.status().first()!!
            assertTrue(a.online(1_000 + AgentHealth.OFFLINE_AFTER_MS - 1))
            assertFalse(a.online(1_000 + AgentHealth.OFFLINE_AFTER_MS))
            // A report it cannot read still says when it was.
            assertEquals(listOf(null, null, emptyList<String>()), listOf(a.due, a.lastError, a.blocked))
        }
}
