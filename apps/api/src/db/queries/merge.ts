import { productTagId } from '@maunedas/shared/util/uuid';
import { ApiError } from '../../errors';

/** Tables whose `variant_id` follows a merged variant (03 §12); a test checks it against the D1 foreign keys. */
export const VARIANT_REFERENCES = [
  'barcodes',
  'purchase_items',
  'price_observations',
  'listings',
  'alert_rules',
  'receipt_aliases',
] as const;

type Kind = 'product' | 'variant';
const TABLE: Record<Kind, 'products' | 'variants'> = { product: 'products', variant: 'variants' };

const invalid = (reason: string) => new ApiError(409, 'MERGE_INVALID', { reason });

/**
 * Admin merge of duplicates (03 §12, RF-CAT-07). Everything that pointed at the source points at the target
 * and the source gets a tombstone, in one batch where every touched row gets the new version, updated_at =
 * now and updated_by = the admin (04 §3.4). Rows are moved whether or not they are deleted, so nothing keeps
 * pointing at the dead source. The target also takes the source's images and, if it had none, its primary one.
 */
export async function mergeDuplicates(
  db: D1Database,
  kind: Kind,
  sourceId: string,
  targetId: string,
  adminId: string,
  now: number,
): Promise<Record<string, number>> {
  if (sourceId === targetId) throw invalid('SAME');
  const table = TABLE[kind];
  const { results } = await db
    .prepare(`SELECT * FROM ${table} WHERE id IN (?1, ?2)`)
    .bind(sourceId, targetId)
    .all<Record<string, unknown>>();
  const source = results.find((r) => r.id === sourceId);
  const target = results.find((r) => r.id === targetId);
  if (!source || !target) throw new ApiError(404, 'NOT_FOUND');
  if (source.deleted_at !== null || target.deleted_at !== null) throw invalid('DELETED');
  if (kind === 'variant' && source.measure !== target.measure) throw invalid('MEASURE_MISMATCH');

  const stamp = `updated_at = ?2, updated_by = ?3, version = (SELECT value FROM sync_meta WHERE key = 'version')`;
  const moves: Array<[string, D1PreparedStatement]> = [];
  const move = (name: string, sql: string, ...extra: unknown[]) =>
    moves.push([name, db.prepare(sql).bind(targetId, now, adminId, sourceId, ...extra)]);

  if (kind === 'variant') {
    for (const ref of VARIANT_REFERENCES) {
      move(ref, `UPDATE ${ref} SET variant_id = ?1, ${stamp} WHERE variant_id = ?4`);
    }
  } else {
    move('variants', `UPDATE variants SET product_id = ?1, ${stamp} WHERE product_id = ?4`);
  }
  move('images', `UPDATE images SET owner_id = ?1, ${stamp} WHERE owner_type = ?5 AND owner_id = ?4`, kind);

  const tail: D1PreparedStatement[] = [];
  if (kind === 'product') {
    // Tags are united without live duplicates: the source's links die and the target's uuidv5 link is
    // created or revived (04 §2.1).
    const { results: tags } = await db
      .prepare('SELECT tag_id FROM product_tags WHERE product_id = ?1 AND deleted_at IS NULL')
      .bind(sourceId)
      .all<{ tag_id: string }>();
    move(
      'product_tags',
      `UPDATE product_tags SET deleted_at = ?2, ${stamp} WHERE product_id = ?4 AND deleted_at IS NULL`,
    );
    for (const { tag_id } of tags) {
      tail.push(
        db
          .prepare(
            `INSERT INTO product_tags (id, product_id, tag_id, created_at, updated_at, deleted_at, updated_by, version)
             VALUES (?1, ?2, ?3, ?4, ?4, NULL, ?5, (SELECT value FROM sync_meta WHERE key = 'version'))
             ON CONFLICT(id) DO UPDATE SET deleted_at = NULL, updated_at = excluded.updated_at,
               updated_by = excluded.updated_by, version = excluded.version
             WHERE product_tags.deleted_at IS NOT NULL`,
          )
          .bind(productTagId(targetId, tag_id), targetId, tag_id, now, adminId),
      );
    }
  }
  if (target.primary_image_id === null && source.primary_image_id !== null) {
    tail.push(
      db
        .prepare(`UPDATE ${table} SET primary_image_id = ?4, ${stamp} WHERE id = ?1`)
        .bind(targetId, now, adminId, source.primary_image_id),
    );
  }
  tail.push(
    db
      .prepare(`UPDATE ${table} SET deleted_at = ?2, ${stamp} WHERE id = ?4`)
      .bind(null, now, adminId, sourceId),
  );

  const written = await db.batch([
    db.prepare(`UPDATE sync_meta SET value = value + 1 WHERE key = 'version'`),
    ...moves.map(([, stmt]) => stmt),
    ...tail,
  ]);
  return Object.fromEntries(moves.map(([name], i) => [name, written[i + 1]!.meta.changes]));
}
