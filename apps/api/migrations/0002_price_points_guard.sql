-- Migration 0002: v_price_points no longer divides by zero when every live line of a purchase
-- is free, and a ticket discount larger than the lines leaves them at 0 instead of negative.
-- docs/esquema-d1.sql holds the accumulated schema; test/schema.test.ts checks they match.

DROP VIEW v_price_points;

CREATE VIEW v_price_points AS
SELECT
  'purchase'                                            AS source,
  pi.id                                                 AS point_id,
  pi.variant_id                                         AS variant_id,
  p.store_id                                            AS store_id,
  p.branch_id                                           AS branch_id,
  NULL                                                  AS listing_id,
  p.purchased_at                                        AS observed_at,
  pi.unit_price_cents                                   AS list_unit_cents,
  CAST(ROUND(pi.final_cents * t.paid_factor / pi.quantity) AS INTEGER)
                                                        AS effective_unit_cents,
  pi.final_cents * t.paid_factor
    / (pi.quantity * v.unit_amount * v.pack_count)      AS cents_per_base,
  (pi.discount_cents > 0 OR p.discount_cents > 0)       AS has_promo
FROM purchase_items pi
JOIN purchases p ON p.id = pi.purchase_id
JOIN variants  v ON v.id = pi.variant_id
JOIN (SELECT i.purchase_id,
             COALESCE(1.0 - MIN(pu.discount_cents, SUM(i.final_cents)) * 1.0 / NULLIF(SUM(i.final_cents), 0), 1.0)
               AS paid_factor
      FROM purchase_items i
      JOIN purchases pu ON pu.id = i.purchase_id
      WHERE i.deleted_at IS NULL
      GROUP BY i.purchase_id) t ON t.purchase_id = pi.purchase_id
WHERE pi.deleted_at IS NULL AND p.deleted_at IS NULL AND p.status = 'confirmed'
UNION ALL
SELECT
  o.source,
  o.id,
  o.variant_id,
  o.store_id,
  o.branch_id,
  o.listing_id,
  o.observed_at,
  o.price_cents,
  COALESCE(o.effective_price_cents, o.price_cents),
  COALESCE(o.effective_price_cents, o.price_cents) * 1.0 / (v.unit_amount * v.pack_count),
  (o.promo_text IS NOT NULL OR o.effective_price_cents IS NOT NULL)
FROM price_observations o
JOIN variants v ON v.id = o.variant_id
WHERE o.deleted_at IS NULL;
