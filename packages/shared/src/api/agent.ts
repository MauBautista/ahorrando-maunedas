import { z } from 'zod';

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
