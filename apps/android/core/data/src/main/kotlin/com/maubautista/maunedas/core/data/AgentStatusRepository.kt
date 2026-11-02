package com.maubautista.maunedas.core.data

import com.maubautista.maunedas.core.database.AppDatabase
import com.maubautista.maunedas.core.database.entity.AgentStatusEntity
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.longOrNull

/** One backup job of the agent (07 §10): done (when, what), failed (why) or not run yet. */
data class BackupJob(
    val ok: Boolean?,
    val at: Long?,
    val error: String?,
    /** Rows of the mirror, the dump's file or the photos copied. */
    val detail: String?,
)

/** The home agent as RF-ADM-03 shows it, from its latest report in Room (`agent_status`, 07 §5.1). */
data class AgentHealth(
    val lastHeartbeatAt: Long?,
    val version: String?,
    val due: Int?,
    val outbox: Int?,
    /** Store names of the adapters with blocked listings. */
    val blocked: List<String>,
    val lastError: String?,
    val mirror: BackupJob,
    val dump: BackupJob,
    val photos: BackupJob,
) {
    /**
     * Whether it reported recently. Room only gets a new report every 10 minutes and the phone pulls every 15
     * (T78), so a phone waits 30 minutes before saying it stopped.
     */
    fun online(now: Long): Boolean = lastHeartbeatAt != null && now - lastHeartbeatAt < OFFLINE_AFTER_MS

    companion object {
        const val OFFLINE_AFTER_MS = 30 * 60_000L
    }
}

/** RF-ADM-03 on the phone: the agent's report comes down by sync, so this works offline too. */
@Singleton
class AgentStatusRepository
    @Inject
    constructor(
        private val db: AppDatabase,
    ) {
        fun status(): Flow<AgentHealth?> = db.tracking().agentStatus().map { it?.toHealth() }

        companion object {
            private val STORES = mapOf("amazon_mx" to "Amazon", "sams_mx" to "Sam’s Club", "costco_mx" to "Costco")

            fun storeName(adapter: String): String = STORES[adapter] ?: adapter
        }
    }

private fun AgentStatusEntity.toHealth(): AgentHealth {
    val info = info?.let { runCatching { Json.parseToJsonElement(it).jsonObject }.getOrNull() } ?: JsonObject(emptyMap())
    val backup = (info["backup"] as? JsonObject) ?: JsonObject(emptyMap())
    fun JsonObject.text(key: String) = (this[key] as? JsonPrimitive)?.contentOrNull
    fun JsonObject.long(key: String) = (this[key] as? JsonPrimitive)?.longOrNull
    fun JsonObject.flag(key: String) = (this[key] as? JsonPrimitive)?.booleanOrNull
    return AgentHealth(
        lastHeartbeatAt = lastHeartbeatAt,
        version = agentVersion,
        due = (info["due"] as? JsonPrimitive)?.intOrNull,
        outbox = (info["outbox"] as? JsonPrimitive)?.intOrNull,
        blocked = (info["blocked"] as? JsonArray).orEmpty().mapNotNull { (it as? JsonPrimitive)?.contentOrNull?.let(AgentStatusRepository::storeName) },
        lastError = info.text("last_error"),
        mirror = BackupJob(backup.flag("mirror_ok"), backup.long("mirror_at"), backup.text("mirror_error"), backup.long("mirror_rows")?.toString()),
        dump = BackupJob(backup.flag("dump_ok"), backup.long("dump_at"), backup.text("dump_error"), backup.text("dump_file")),
        photos = BackupJob(backup.flag("photos_ok"), backup.long("photos_at"), backup.text("photos_error"), backup.long("photos_files")?.toString()),
    )
}
