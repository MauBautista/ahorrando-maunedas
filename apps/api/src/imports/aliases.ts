import { normalizeReceiptText } from '@maunedas/shared/receipts/normalize';

/**
 * The variant each text links to by [storeId]'s receipt aliases (09 §5.1), or null; one query for any number of
 * texts. Imported invoices and files link their lines this way, as a reviewed receipt would.
 */
export async function aliasVariants(
  db: D1Database,
  storeId: string | null,
  texts: readonly string[],
): Promise<Array<string | null>> {
  const norms = texts.map(normalizeReceiptText);
  const aliases = new Map<string, string>();
  if (storeId && norms.length > 0) {
    const { results } = await db
      .prepare(
        `SELECT a.raw_text_norm, a.variant_id FROM receipt_aliases a JOIN variants v ON v.id = a.variant_id
         WHERE a.store_id = ?1 AND a.deleted_at IS NULL AND v.deleted_at IS NULL
           AND a.raw_text_norm IN (SELECT value FROM json_each(?2))`,
      )
      .bind(storeId, JSON.stringify([...new Set(norms)]))
      .all<{ raw_text_norm: string; variant_id: string }>();
    for (const a of results) aliases.set(a.raw_text_norm, a.variant_id);
  }
  return norms.map((n) => aliases.get(n) ?? null);
}
