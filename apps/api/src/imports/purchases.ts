import type {
  ImportPurchase,
  ImportRequest,
  ImportResponse,
  ImportResult,
} from '@maunedas/shared/api/imports';
import { normalizeReceiptText } from '@maunedas/shared/receipts/normalize';
import { uuidv7 } from '@maunedas/shared/util/uuid';
import { ApiError } from '../errors';
import { aliasVariants } from './aliases';

/**
 * What makes two imported purchases the same (03 §15): store, time, folio and each line as paid, its text
 * normalized. The same file imported again gives the same fingerprints.
 */
export async function fingerprint(p: ImportPurchase): Promise<string> {
  const canonical = JSON.stringify([
    p.store_id,
    p.purchased_at,
    p.ticket,
    p.lines.map((l) => [normalizeReceiptText(l.description), l.quantity, l.unit_price_cents, l.final_cents]),
  ]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Purchases read from a spreadsheet as drafts (`source='import'`, T-306), the way an invoice is imported (03 §14):
 * lines linked by the store's receipt aliases, everything in one batch under one new sync version, and a
 * `purchase_imports` row with its fingerprint. A purchase whose fingerprint already is a live purchase, or repeats
 * one earlier in the request, is not created again: its result points to that purchase.
 */
export async function importPurchases(
  db: D1Database,
  request: ImportRequest,
  userId: string,
  now: number,
): Promise<ImportResponse> {
  const storeIds = [...new Set(request.purchases.map((p) => p.store_id))];
  const prints = await Promise.all(request.purchases.map(fingerprint));
  const [stores, existing] = await db.batch<Record<string, unknown>>([
    db
      .prepare('SELECT id FROM stores WHERE deleted_at IS NULL AND id IN (SELECT value FROM json_each(?1))')
      .bind(JSON.stringify(storeIds)),
    db
      .prepare(
        `SELECT pi.fingerprint, pi.purchase_id FROM purchase_imports pi JOIN purchases p ON p.id = pi.purchase_id
         WHERE p.deleted_at IS NULL AND pi.fingerprint IN (SELECT value FROM json_each(?1))
         ORDER BY pi.created_at`,
      )
      .bind(JSON.stringify(prints)),
  ]);
  if (stores!.results.length !== storeIds.length) throw new ApiError(404, 'NOT_FOUND', { field: 'store_id' });
  const known = new Map(existing!.results.map((r) => [String(r.fingerprint), String(r.purchase_id)]));

  const version = `(SELECT value FROM sync_meta WHERE key = 'version')`;
  const writes: D1PreparedStatement[] = [];
  const results: ImportResult[] = [];
  for (const [i, p] of request.purchases.entries()) {
    const already = known.get(prints[i]!);
    if (already) {
      results.push({ purchase_id: already, status: 'duplicate', lines: p.lines.length, linked: 0 });
      continue;
    }
    const purchaseId = uuidv7(now);
    known.set(prints[i]!, purchaseId);
    const variants = await aliasVariants(
      db,
      p.store_id,
      p.lines.map((l) => l.description),
    );
    const total = p.lines.reduce((sum, l) => sum + l.final_cents, 0);
    const notes = `Importado de ${request.file_name}${p.ticket ? ` · folio ${p.ticket}` : ''}`;
    // [id, line_no, variant_id, raw_text, quantity, unit_price_cents, final_cents]; gross = final, no discount.
    const lines = p.lines.map((l, n) => [
      uuidv7(now),
      n + 1,
      variants[n],
      l.description,
      l.quantity,
      l.unit_price_cents,
      l.final_cents,
    ]);
    writes.push(
      db
        .prepare(
          `INSERT INTO purchases (id, store_id, purchased_at, currency, subtotal_cents, discount_cents, total_cents,
             source, status, notes, created_at, updated_at, updated_by, version)
           VALUES (?1, ?2, ?3, 'MXN', ?4, 0, ?4, 'import', 'draft', ?5, ?6, ?6, ?7, ${version})`,
        )
        .bind(purchaseId, p.store_id, p.purchased_at, total, notes.slice(0, 2000), now, userId),
      db
        .prepare(
          `INSERT INTO purchase_items (id, purchase_id, line_no, variant_id, raw_text, quantity, unit_price_cents,
             gross_cents, discount_cents, final_cents, created_at, updated_at, updated_by, version)
           SELECT json_extract(value, '$[0]'), ?1, json_extract(value, '$[1]'), json_extract(value, '$[2]'),
             json_extract(value, '$[3]'), json_extract(value, '$[4]'), json_extract(value, '$[5]'),
             json_extract(value, '$[6]'), 0, json_extract(value, '$[6]'), ?2, ?2, ?3, ${version}
           FROM json_each(?4)`,
        )
        .bind(purchaseId, now, userId, JSON.stringify(lines)),
      db
        .prepare(
          `INSERT INTO purchase_imports (id, fingerprint, purchase_id, file_name, created_by, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
        )
        .bind(uuidv7(now), prints[i]!, purchaseId, request.file_name, userId, now),
    );
    results.push({
      purchase_id: purchaseId,
      status: 'created',
      lines: p.lines.length,
      linked: variants.filter((v) => v !== null).length,
    });
  }
  if (writes.length > 0) {
    await db.batch([
      db.prepare('PRAGMA defer_foreign_keys = on'),
      db.prepare(`UPDATE sync_meta SET value = value + 1 WHERE key = 'version'`),
      ...writes,
    ]);
  }
  return { results };
}
