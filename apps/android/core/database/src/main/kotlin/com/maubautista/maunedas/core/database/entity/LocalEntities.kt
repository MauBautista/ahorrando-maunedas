package com.maubautista.maunedas.core.database.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/** Rows with local changes to push (04 §6.1). Re-editing a row replaces its entry: edits coalesce. */
@Entity(tableName = "outbox", indices = [Index(value = ["table_name", "row_id"], unique = true)])
data class OutboxEntry(
    @PrimaryKey(autoGenerate = true) val seq: Long = 0,
    @ColumnInfo(name = "table_name") val tableName: String,
    @ColumnInfo(name = "row_id") val rowId: String,
    @ColumnInfo(name = "enqueued_at") val enqueuedAt: Long,
)

/** Binaries to upload (`kind = blob`) or open catalog imports (`kind = import`, with `source_url`, 10 §2.3). */
@Entity(tableName = "pending_uploads", indices = [Index(value = ["image_id", "name"], unique = true)])
data class PendingUploadEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val kind: String,
    @ColumnInfo(name = "image_id") val imageId: String,
    val name: String,
    @ColumnInfo(name = "local_path") val localPath: String? = null,
    @ColumnInfo(name = "source_url") val sourceUrl: String? = null,
    @ColumnInfo(name = "content_type") val contentType: String? = null,
    val attempts: Int = 0,
    @ColumnInfo(name = "last_error") val lastError: String? = null,
    @ColumnInfo(name = "created_at") val createdAt: Long,
)

/** Pull cursor `(version, last_id)` per table (04 §4). */
@Entity(tableName = "sync_cursors")
data class SyncCursorEntity(
    @PrimaryKey @ColumnInfo(name = "table_name") val tableName: String,
    val version: Long,
    @ColumnInfo(name = "last_id") val lastId: String,
)

/** Conflicts that need an action or a notice (04 §6.1). */
@Entity(tableName = "sync_issues", indices = [Index("resolved_at")])
data class SyncIssueEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    @ColumnInfo(name = "table_name") val tableName: String,
    @ColumnInfo(name = "row_id") val rowId: String,
    val reason: String,
    @ColumnInfo(name = "details_json") val detailsJson: String? = null,
    @ColumnInfo(name = "created_at") val createdAt: Long,
    @ColumnInfo(name = "resolved_at") val resolvedAt: Long? = null,
)
