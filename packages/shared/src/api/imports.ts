import { z } from 'zod';

/** The most purchases one `POST /v1/purchases/import` brings; the web sends a file in several. */
export const IMPORT_MAX_PURCHASES = 20;
/** The most lines of one imported purchase, as an invoice's (03 §14). */
export const IMPORT_MAX_LINES = 300;

/** A line as it was paid: the unit price and what the line cost. */
export const ImportLineSchema = z.strictObject({
  description: z.string().trim().min(1).max(300),
  quantity: z.number().positive().max(100_000),
  unit_price_cents: z.number().int().nonnegative().max(100_000_000),
  final_cents: z.number().int().nonnegative().max(100_000_000),
});
export type ImportLine = z.infer<typeof ImportLineSchema>;

export const ImportPurchaseSchema = z.strictObject({
  store_id: z.uuid(),
  purchased_at: z.number().int().positive(),
  /** The file's folio or ticket that grouped the lines, if it had one. */
  ticket: z.string().trim().min(1).max(100).nullable(),
  lines: z.array(ImportLineSchema).min(1).max(IMPORT_MAX_LINES),
});
export type ImportPurchase = z.infer<typeof ImportPurchaseSchema>;

/** `POST /v1/purchases/import` (03 §15, T-306). */
export const ImportRequestSchema = z.strictObject({
  file_name: z.string().trim().min(1).max(200),
  purchases: z.array(ImportPurchaseSchema).min(1).max(IMPORT_MAX_PURCHASES),
});
export type ImportRequest = z.infer<typeof ImportRequestSchema>;

/** One result per purchase sent, in order: a new draft, or the live purchase it already was. */
export interface ImportResult {
  purchase_id: string;
  status: 'created' | 'duplicate';
  lines: number;
  /** Lines the store's receipt aliases linked to a variant (09 §5.1); 0 for a duplicate. */
  linked: number;
}

export interface ImportResponse {
  results: ImportResult[];
}
