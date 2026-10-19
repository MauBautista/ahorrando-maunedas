import { z } from 'zod';

/** Push limits (04 §3.1, CLAUDE.md rule 13). */
export const PUSH_MAX_MUTATIONS = 100;
export const PUSH_MAX_BYTES = 512 * 1024;

/** `POST /v1/sync/push` request (04 §3.1). Rows are validated per table after sanitizing. */
export const PushRequestSchema = z.strictObject({
  device_id: z.uuid(),
  mutations: z
    .array(z.strictObject({ table: z.string().min(1).max(64), row: z.record(z.string(), z.unknown()) }))
    .min(1)
    .max(PUSH_MAX_MUTATIONS),
});

export type PushRequest = z.infer<typeof PushRequestSchema>;

export type ConflictReason =
  'STALE' | 'BARCODE_TAKEN' | 'ALIAS_TAKEN' | 'VALIDATION' | 'FORBIDDEN' | 'IMMUTABLE_ROW' | 'UNKNOWN_TABLE';

export interface PushConflict {
  table: string;
  id: string;
  reason: ConflictReason;
  /** Current server state of that row, if it exists. */
  server_row: Record<string, unknown> | null;
  details?: unknown;
}

/** `200` response: a push with conflicts is not an error. */
export interface PushResponse {
  applied: number;
  skipped: number;
  conflicts: PushConflict[];
}

/** Pull limits (04 §4.1). The default page is 100 rows per table to stay near the Free CPU limit (spike D). */
export const PULL_MAX_LIMIT = 500;
export const PULL_DEFAULT_LIMIT = 100;

/** Cursor of one table: `[version, primary key]` of the last row received; `[0, ""]` = from the start. */
export const PullCursorSchema = z.tuple([z.number().int().nonnegative(), z.string().max(64)]);
export type PullCursor = z.infer<typeof PullCursorSchema>;

/** `POST /v1/sync/pull` request (04 §4.1). Table names are checked against the registry by the Worker. */
export const PullRequestSchema = z.strictObject({
  cursors: z.record(z.string().min(1).max(64), PullCursorSchema).default({}),
  limit: z.number().int().min(1).max(PULL_MAX_LIMIT).default(PULL_DEFAULT_LIMIT),
  tables: z.array(z.string().min(1).max(64)).min(1).optional(),
});

export type PullRequest = z.infer<typeof PullRequestSchema>;

export interface PullResponse {
  /** Only tables with rows, in processing order (parents first). Tombstones travel too. */
  changes: Record<string, Array<Record<string, unknown>>>;
  /** New cursor of every queried table. */
  cursors: Record<string, PullCursor>;
  /** Some table returned `limit` rows: pull again. */
  has_more: boolean;
  server_time: number;
  schema_version: number;
}
