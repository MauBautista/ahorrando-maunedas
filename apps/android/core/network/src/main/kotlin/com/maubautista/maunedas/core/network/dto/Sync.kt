package com.maubautista.maunedas.core.network.dto

import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.descriptors.listSerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonEncoder
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long

/** One row change of `POST /v1/sync/push` (04 §3.1). Rows travel as JSON objects with the D1 column names. */
@Serializable
data class Mutation(val table: String, val row: JsonObject)

/** At most 100 mutations and 512 KB per request (CLAUDE.md rule 13). */
@Serializable
data class PushRequest(val deviceId: String, val mutations: List<Mutation>)

@Serializable
data class PushResponse(val applied: Int, val skipped: Int = 0, val conflicts: List<PushConflict>)

/** reason: STALE, BARCODE_TAKEN, ALIAS_TAKEN, VALIDATION, FORBIDDEN, IMMUTABLE_ROW or UNKNOWN_TABLE. */
@Serializable
data class PushConflict(
    val table: String,
    val id: String,
    val reason: String,
    val serverRow: JsonObject? = null,
    val details: JsonElement? = null,
)

/** Cursor of one table, `[version, last primary key]` on the wire; `[0, ""]` = from the start (04 §4.1). */
@Serializable(with = PullCursorSerializer::class)
data class PullCursor(val version: Long, val lastId: String) {
    companion object {
        val START = PullCursor(0, "")
    }
}

object PullCursorSerializer : KSerializer<PullCursor> {
    override val descriptor: SerialDescriptor = listSerialDescriptor<JsonElement>()

    override fun serialize(
        encoder: Encoder,
        value: PullCursor,
    ) = (encoder as JsonEncoder).encodeJsonElement(JsonArray(listOf(JsonPrimitive(value.version), JsonPrimitive(value.lastId))))

    override fun deserialize(decoder: Decoder): PullCursor {
        val array = (decoder as JsonDecoder).decodeJsonElement().jsonArray
        require(array.size == 2) { "Cursor inválido: $array" }
        return PullCursor(array[0].jsonPrimitive.long, array[1].jsonPrimitive.content)
    }
}

/** `POST /v1/sync/pull`: 100 rows per table by default, at most 500 (spike D, T40). */
@OptIn(ExperimentalSerializationApi::class)
@Serializable
data class PullRequest(
    val cursors: Map<String, PullCursor>,
    val limit: Int = 100,
    /** All tables when absent. The Worker accepts a missing key or a list, never `null` (PullRequestSchema). */
    @EncodeDefault(EncodeDefault.Mode.NEVER) val tables: List<String>? = null,
)

@Serializable
data class PullResponse(
    val changes: Map<String, List<JsonObject>>,
    val cursors: Map<String, PullCursor>,
    val hasMore: Boolean,
    val serverTime: Long,
    val schemaVersion: Int,
)
