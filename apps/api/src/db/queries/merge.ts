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
  dryRun = false,
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
  // Each move once: its UPDATE, and the count of the same rows for the preview (`dry_run`, W-12). In `where`,
  // ?4 is the source and ?5 the kind.
  const plan: Array<{ name: string; set: string; where: string }> = [];
  if (kind === 'variant') {
    for (const ref of VARIANT_REFERENCES)
      plan.push({ name: ref, set: 'variant_id = ?1', where: 'variant_id = ?4' });
  } else {
    plan.push({ name: 'variants', set: 'product_id = ?1', where: 'product_id = ?4' });
  }
  plan.push({ name: 'images', set: 'owner_id = ?1', where: 'owner_type = ?5 AND owner_id = ?4' });
  if (kind === 'product') {
    plan.push({
      name: 'product_tags',
      set: 'deleted_at = ?2',
      where: 'product_id = ?4 AND deleted_at IS NULL',
    });
  }

  if (dryRun) {
    const counts = await db.batch<{ n: number }>(
      plan.map((m) =>
        db
          .prepare(
            `SELECT count(*) AS n FROM ${m.name} WHERE ${m.where.replace('?4', '?1').replace('?5', '?2')}`,
          )
          .bind(...(m.where.includes('?5') ? [sourceId, kind] : [sourceId])),
      ),
    );
    return Object.fromEntries(plan.map((m, i) => [m.name, counts[i]!.results[0]!.n]));
  }

  const moves: Array<[string, D1PreparedStatement]> = plan.map((m) => [
    m.name,
    db
      .prepare(`UPDATE ${m.name} SET ${m.set}, ${stamp} WHERE ${m.where}`)
      .bind(targetId, now, adminId, sourceId, ...(m.where.includes('?5') ? [kind] : [])),
  ]);

  const tail: D1PreparedStatement[] = [];
  if (kind === 'product') {
    // Tags are united without live duplicates: the source's links die and the target's uuidv5 link is
    // created or revived (04 §2.1).
    const { results: tags } = await db
      .prepare('SELECT tag_id FROM product_tags WHERE product_id = ?1 AND deleted_at IS NULL')
      .bind(sourceId)
      .all<{ tag_id: string }>();
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
