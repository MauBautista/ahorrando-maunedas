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
