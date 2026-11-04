import { z } from 'zod';
import { PULL_DEFAULT_LIMIT, PULL_MAX_LIMIT, PullCursorSchema, type PullResponse } from './sync';

/** The agent's report on itself (07 §5.1); kept as `agent_status.info`. New fields are kept as they come. */
export const AgentInfoSchema = z
  .object({
    outbox: z.number().int().nonnegative(),
    due: z.number().int().nonnegative(),
    mem_mb: z.number().nonnegative(),
    load1: z.number().nonnegative(),
    /** Adapters with blocked listings. */
    blocked: z.array(z.string().max(40)).max(50),
    last_error: z.string().max(500).nullable(),
  })
  .passthrough();

/** `POST /agent/v1/work` (07 §5.1). */
export const AgentWorkRequestSchema = z.object({
  agent_id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  agent_version: z.string().min(1).max(40),
  /** `[version, id]` of the last listing received; `[0, ""]` the first time. */
  cursor: z.tuple([z.number().int().nonnegative(), z.string().max(40)]),
  info: AgentInfoSchema,
});

export type AgentWorkRequest = z.infer<typeof AgentWorkRequestSchema>;

export interface AgentListing {
  id: string;
  adapter: string;
  url: string;
  canonical_url: string | null;
  external_id: string | null;
  store_id: string;
  interval_min: number | null;
  active: number;
  version: number;
}

export interface AgentWorkResponse {
  server_time: number;
  listings: {
    upserts: AgentListing[];
    /** Deleted or deactivated listings. */
    removed: string[];
    cursor: [number, string];
    has_more: boolean;
  };
  /** `stores.default_check_interval_min` by store. */
  store_defaults: Record<string, number>;
  /** "Revisar ahora": `check_requested_at > COALESCE(last_checked_at, 0)`. */
  check_now: string[];
  image_jobs_queued: number;
  config: { min_spacing_s: Record<string, number> };
}

/** One check of a listing by the agent (07 §5.2). */
export const AgentResultSchema = z.object({
  listing_id: z.uuid(),
  checked_at: z.number().int().positive(),
  status: z.enum(['ok', 'not_found', 'blocked', 'error']),
  price_cents: z.number().int().nonnegative().nullable(),
  list_price_cents: z.number().int().nonnegative().nullable().optional(),
  in_stock: z.boolean().nullable().optional(),
  promo_text: z.string().max(300).nullable().optional(),
  /** Seller, method… kept as the observation's `extra`. */
  extra: z.record(z.string(), z.unknown()).nullable().optional(),
  error: z.string().max(500).nullable().optional(),
});

export type AgentResult = z.infer<typeof AgentResultSchema>;

/** `POST /agent/v1/observations`: 1 to 20 results (CLAUDE.md rule 13). */
export const AgentObservationsRequestSchema = z.object({
  results: z.array(AgentResultSchema).min(1).max(20),
});

export interface AgentObservationsResponse {
  accepted: number;
  observations_created: number;
}

/** A row of `agent_status` (down), with `info` as the agent sent it. */
export interface AgentStatusRow {
  id: string;
  last_heartbeat_at: number | null;
  agent_version: string | null;
  info: Record<string, unknown> | null;
  updated_at: number;
  version: number;
}

/** `GET /v1/admin/agent` (03 §12, W-22). */
export interface AdminAgentResponse {
  status: AgentStatusRow | null;
  /** Heartbeat less than 3 minutes old. */
  online: boolean;
  blocked_listings: number;
  failing_listings: number;
  queued_image_jobs: number;
}

/**
 * Server tables outside the sync registry that a restore needs (07 §5.4): append-only rows, read by
 * `(created_at, pk)`.
 */
export const BACKUP_APPEND_TABLES = {
  receipt_extractions: 'id',
  ai_usage: 'id',
  cfdi_imports: 'id',
  purchase_imports: 'id',
} as const;

/**
 * Sent whole on every backup pull and replaced in the mirror: their rows can be deleted (removing a user's Google
 * login), and a mirror that kept a deleted login would bring it back on a restore. Small by nature.
 */
export const BACKUP_SNAPSHOT_TABLES = { user_identities: 'firebase_uid' } as const;

/** `POST /agent/v1/backup/pull` (07 §5.4): like `/v1/sync/pull`, for every user and with every column. */
export const BackupPullRequestSchema = z.strictObject({
  cursors: z.record(z.string().min(1).max(64), PullCursorSchema).default({}),
  limit: z.number().int().min(1).max(PULL_MAX_LIMIT).default(PULL_DEFAULT_LIMIT),
  tables: z.array(z.string().min(1).max(64)).min(1).optional(),
});

export type BackupPullRequest = z.infer<typeof BackupPullRequestSchema>;

export interface BackupPullResponse extends PullResponse {
  /** Tables in `changes` that come whole: the mirror replaces them instead of merging. */
  replace: string[];
}

/** A claimed image job lives this long; then another claim takes it (07 §5.3). */
export const JOB_LEASE_MS = 600_000;

/** A job claimed this many times without completing ends `failed`. */
export const JOB_MAX_ATTEMPTS = 3;

/** `POST /agent/v1/jobs/claim` (07 §5.3); `204` when there is none. */
export interface AgentJobClaim {
  job: { id: string; image_id: string; op: 'remove_bg'; original_url: string; attempts: number };
}

/** `PUT /agent/v1/jobs/:jobId/result/:kind`. */
export interface AgentJobResult {
  rendition_id: string;
}

/** `POST /agent/v1/jobs/:jobId/fail`. */
export const AgentJobFailSchema = z.strictObject({ error: z.string().trim().min(1).max(500) });
