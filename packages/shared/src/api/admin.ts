import { z } from 'zod';

/** `POST /v1/admin/merge` (03 §12). */
export const MergeRequestSchema = z.object({
  kind: z.enum(['product', 'variant']),
  source_id: z.uuid(),
  target_id: z.uuid(),
});

export interface MergeResponse {
  /** Rows moved to the target, per table. */
  moved: Record<string, number>;
}
