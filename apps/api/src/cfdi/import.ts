import type { CfdiImportResponse, CfdiLine, CfdiPreviewResponse } from '@maunedas/shared/api/cfdi';
import { normalizeReceiptText } from '@maunedas/shared/receipts/normalize';
import { matchStoreName } from '@maunedas/shared/receipts/stores';
import { uuidv7 } from '@maunedas/shared/util/uuid';
import { ApiError } from '../errors';
import { CfdiRejected, type ParsedCfdi, parseCfdi } from './parse';

/** The invoice, or `422 E-UNSUPPORTED_CFDI` with why. */
export function readCfdi(xml: string): ParsedCfdi {
  try {
    return parseCfdi(xml);
  } catch (e) {
    if (e instanceof CfdiRejected) throw new ApiError(422, 'UNSUPPORTED_CFDI', { reason: e.reason });
    throw e;
  }
}

/** The live purchase an invoice already became (a deleted one lets it in again). */
async function importedPurchase(db: D1Database, fiscalUuid: string): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT ci.purchase_id FROM cfdi_imports ci JOIN purchases p ON p.id = ci.purchase_id
       WHERE ci.fiscal_uuid = ?1 AND p.deleted_at IS NULL ORDER BY ci.created_at DESC LIMIT 1`,
    )
    .bind(fiscalUuid)
    .first<{ purchase_id: string }>();
  return row?.purchase_id ?? null;
}

/** Each line's variant from the store's receipt aliases, by the normalized text (09 §5.1). */
async function linked(db: D1Database, storeId: string | null, cfdi: ParsedCfdi): Promise<CfdiLine[]> {
  const norms = cfdi.lines.map((l) => normalizeReceiptText(l.description));
  const aliases = new Map<string, string>();
  if (storeId) {
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
  return cfdi.lines.map((l, i) => ({
    line_no: i + 1,
    description: l.description,
    quantity: l.quantity,
    unit_price_cents: l.unitPriceCents,
    gross_cents: l.grossCents,
    discount_cents: l.discountCents,
    final_cents: l.finalCents,
    sku: l.sku,
    variant_id: aliases.get(norms[i]!) ?? null,
  }));
}

/**
 * What an invoice would become (03 §14): its lines as paid, a store to suggest and whether it was already imported.
 * - **Store by RFC:** the one this issuer's invoices went to, only if always the same. Nueva Wal-Mart de México bills
 *   for Walmart, Bodega Aurrera and Sam's with one RFC, so an RFC seen with several stores suggests none.
 * - **Store by name:** a new RFC falls back to the issuer's name (`matchStoreName`, which ignores that group's legal
 *   name).
 */
export async function previewCfdi(db: D1Database, xml: string): Promise<CfdiPreviewResponse> {
  const cfdi = readCfdi(xml);
  const [byRfc, stores] = await db.batch<Record<string, unknown>>([
    db
      .prepare(
        `SELECT DISTINCT ci.store_id FROM cfdi_imports ci JOIN stores s ON s.id = ci.store_id
         WHERE ci.emisor_rfc = ?1 AND s.deleted_at IS NULL`,
      )
      .bind(cfdi.emisor.rfc),
    db.prepare('SELECT id, name FROM stores WHERE deleted_at IS NULL'),
  ]);
  const seen = byRfc!.results.map((r) => r.store_id as string);
  const storeId =
    seen.length === 1
      ? seen[0]!
      : seen.length === 0
        ? matchStoreName(cfdi.emisor.name, stores!.results as Array<{ id: string; name: string }>)
        : null;
  const lines = await linked(db, storeId, cfdi);
  return {
    fiscal_uuid: cfdi.fiscalUuid,
    issued_at: cfdi.issuedAt,
    emisor: cfdi.emisor,
    total_cents: cfdi.totalCents,
    lines,
    linked: lines.filter((l) => l.variant_id !== null).length,
    store_id: storeId,
    imported_purchase_id: await importedPurchase(db, cfdi.fiscalUuid),
  };
}

/**
 * The invoice as a draft purchase of [storeId] (`source='cfdi'`), its lines and the `cfdi_imports` row, in one
 * batch under one new sync version, as the admin merge writes (03 §12). The household reviews and confirms it
 * like any draft; Android gets it by pull.
 */
export async function importCfdi(
  db: D1Database,
  xml: string,
  storeId: string,
  userId: string,
  now: number,
): Promise<CfdiImportResponse> {
  const cfdi = readCfdi(xml);
  const store = await db
    .prepare('SELECT id FROM stores WHERE id = ?1 AND deleted_at IS NULL')
    .bind(storeId)
    .first();
  if (!store) throw new ApiError(404, 'NOT_FOUND', { field: 'store_id' });
  const already = await importedPurchase(db, cfdi.fiscalUuid);
  if (already) throw new ApiError(409, 'CFDI_ALREADY_IMPORTED', { purchase_id: already });
  const lines = await linked(db, storeId, cfdi);
  const purchaseId = uuidv7(now);
  const version = `(SELECT value FROM sync_meta WHERE key = 'version')`;
  const subtotal = lines.reduce((acc, l) => acc + l.gross_cents, 0);
  await db.batch([
    db.prepare('PRAGMA defer_foreign_keys = on'),
    db.prepare(`UPDATE sync_meta SET value = value + 1 WHERE key = 'version'`),
    db
      .prepare(
        `INSERT INTO purchases (id, store_id, purchased_at, currency, subtotal_cents, discount_cents, total_cents,
           source, status, notes, created_at, updated_at, updated_by, version)
         VALUES (?1, ?2, ?3, 'MXN', ?4, 0, ?5, 'cfdi', 'draft', ?6, ?7, ?7, ?8, ${version})`,
      )
      .bind(
        purchaseId,
        storeId,
        cfdi.issuedAt,
        subtotal,
        cfdi.totalCents,
        `Factura ${cfdi.fiscalUuid}${cfdi.emisor.name ? ` de ${cfdi.emisor.name}` : ''}`.slice(0, 2000),
        now,
        userId,
      ),
    ...lines.map((l) =>
      db
        .prepare(
          `INSERT INTO purchase_items (id, purchase_id, line_no, variant_id, raw_text, quantity, unit_price_cents,
             gross_cents, discount_cents, final_cents, created_at, updated_at, updated_by, version)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11, ?12, ${version})`,
        )
        .bind(
          uuidv7(now),
          purchaseId,
          l.line_no,
          l.variant_id,
          l.description,
          l.quantity,
          l.unit_price_cents,
          l.gross_cents,
          l.discount_cents,
          l.final_cents,
          now,
          userId,
        ),
    ),
    db
      .prepare(
        `INSERT INTO cfdi_imports (id, fiscal_uuid, purchase_id, store_id, emisor_rfc, emisor_name, created_by, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      )
      .bind(
        uuidv7(now),
        cfdi.fiscalUuid,
        purchaseId,
        storeId,
        cfdi.emisor.rfc,
        cfdi.emisor.name,
        userId,
        now,
      ),
  ]);
  return {
    purchase_id: purchaseId,
    lines: lines.length,
    linked: lines.filter((l) => l.variant_id !== null).length,
  };
}
