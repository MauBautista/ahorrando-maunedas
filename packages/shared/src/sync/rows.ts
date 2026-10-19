// Zod row schemas per synced table (04 §2). Push validates every incoming row with them after keeping
// only `writable` columns; clients use them for forms and for pulled rows.
//
// Compatibility rule (04 §3.3): NOT NULL columns without a default are required; columns with a default
// or that accept NULL are optional, so a client on an older schema can omit columns it does not know.
// New columns must always be added as optional. Absent = "do not touch"; `null` = "set NULL".
import { z } from 'zod';
import { normalizeReceiptText } from '../receipts/normalize';
import { ADAPTERS } from '../tracking/adapters';
import { productTagId, receiptAliasId } from '../util/uuid';
import type { TableName } from './registry';

const id = z.uuid();
const ms = z.number().int().nonnegative();
const bool01 = z.union([z.literal(0), z.literal(1)]);
const cents = z.number().int().nonnegative();
const text = (max: number) => z.string().max(max);
const name = z.string().trim().min(1).max(200);
const url = z.url({ protocol: /^https?$/ }).max(2048);
const json = (max: number) =>
  z
    .string()
    .max(max)
    .refine((s) => {
      try {
        JSON.parse(s);
        return true;
      } catch {
        return false;
      }
    }, 'JSON inválido');
/** Tracking interval: at least 1 h (rule 10, low frequency), at most 7 days. */
const intervalMin = z.number().int().min(60).max(10_080);

const opt = <T extends z.ZodType>(schema: T) => schema.nullable().optional();

const syncCols = {
  id,
  created_at: ms,
  updated_at: ms,
  deleted_at: opt(ms),
  updated_by: opt(text(64)),
};

export const StoreRowSchema = z.object({
  ...syncCols,
  name,
  chain: opt(text(200)),
  kind: z.enum(['physical', 'online', 'both']),
  website: opt(url),
  adapter: opt(z.enum(ADAPTERS)),
  default_check_interval_min: intervalMin.optional(),
});

export const StoreBranchRowSchema = z.object({
  ...syncCols,
  store_id: id,
  name,
  city: opt(text(100)),
  address: opt(text(300)),
  lat: opt(z.number().min(-90).max(90)),
  lng: opt(z.number().min(-180).max(180)),
});

export const CategoryRowSchema = z
  .object({
    ...syncCols,
    parent_id: opt(id),
    name,
    sort_order: z.number().int().optional(),
  })
  .refine((r) => r.parent_id !== r.id, {
    message: 'Una categoría no puede ser su propia madre',
    path: ['parent_id'],
  });

export const TagRowSchema = z.object({ ...syncCols, name: z.string().trim().min(1).max(100) });

export const ProductRowSchema = z.object({
  ...syncCols,
  name,
  brand: opt(text(200)),
  category_id: opt(id),
  display_unit: z.enum(['kg', '100g', 'L', '100ml', 'pz']).optional(),
  notes: opt(text(2000)),
  primary_image_id: opt(id),
  search_key: text(500).optional(),
});

export const ProductTagRowSchema = z
  .object({ ...syncCols, product_id: id, tag_id: id })
  .refine((r) => r.id === productTagId(r.product_id, r.tag_id), {
    message: 'El id debe ser uuidv5(product_id:tag_id) (04 §2.1)',
    path: ['id'],
  });

export const VariantRowSchema = z
  .object({
    ...syncCols,
    product_id: id,
    label: z.string().trim().min(1).max(100),
    measure: z.enum(['mass', 'volume', 'count']),
    unit_amount: z.number().positive(),
    pack_count: z.number().int().min(1).optional(),
    sold_by_weight: bool01.optional(),
    primary_image_id: opt(id),
  })
  .refine(
    (r) =>
      r.sold_by_weight !== 1 || (r.measure === 'mass' && r.unit_amount === 1000 && (r.pack_count ?? 1) === 1),
    { message: 'A granel solo con masa, 1000 g y paquete de 1 (S-10)', path: ['sold_by_weight'] },
  );

export const BarcodeRowSchema = z.object({
  ...syncCols,
  variant_id: id,
  code: z.string().regex(/^\d{6,14}$/, 'De 6 a 14 dígitos'),
  format: opt(text(32)),
  source: z.enum(['scan', 'off', 'manual', 'receipt']),
});

export const ImageRowSchema = z
  .object({
    ...syncCols,
    owner_type: z.enum(['product', 'variant', 'purchase', 'observation']),
    owner_id: id,
    role: z.enum(['catalog', 'receipt', 'shelf_photo']),
    source: z.enum(['user', 'off', 'generated']),
    license: opt(text(200)),
    attribution: opt(text(300)),
    source_url: opt(url),
    original_key: opt(text(200)),
    selected_processed_id: opt(id),
    selected_thumb_id: opt(id),
    edit_params: opt(json(4000)),
    enhance_requested_at: opt(ms),
  })
  .refine(
    (r) =>
      r.original_key == null || new RegExp(`^images/${r.id}/original\\.(jpg|png|webp)$`).test(r.original_key),
    { message: 'original_key debe ser images/{id}/original.{jpg|png|webp}', path: ['original_key'] },
  );

export const ImageRenditionRowSchema = z
  .object({
    ...syncCols,
    image_id: id,
    kind: z.enum(['mask', 'processed', 'thumb']),
    tier: z.enum(['catalog', 'device', 'home', 'ai', 'manual']),
    r2_key: text(200),
    width: opt(z.number().int().positive().max(10_000)),
    height: opt(z.number().int().positive().max(10_000)),
    bytes: opt(z.number().int().nonnegative()),
  })
  .refine((r) => new RegExp(`^images/${r.image_id}/${r.id}\\.(webp|png)$`).test(r.r2_key), {
    message: 'r2_key debe ser images/{image_id}/{id}.{webp|png}',
    path: ['r2_key'],
  });

export const ListingRowSchema = z.object({
  ...syncCols,
  variant_id: id,
  store_id: id,
  adapter: z.enum(ADAPTERS),
  url,
  canonical_url: opt(url),
  external_id: opt(text(100)),
  check_interval_min: opt(intervalMin),
  active: bool01.optional(),
});

export const PurchaseRowSchema = z.object({
  ...syncCols,
  store_id: id,
  branch_id: opt(id),
  purchased_at: ms,
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  subtotal_cents: opt(cents),
  discount_cents: cents.optional(),
  total_cents: opt(cents),
  source: z.enum(['manual', 'receipt_ai', 'receipt_ocr', 'email', 'cfdi', 'import']),
  status: z.enum(['draft', 'confirmed']).optional(),
  receipt_image_id: opt(id),
  notes: opt(text(2000)),
});

// gross/discount/final always travel together so their arithmetic can be checked.
export const PurchaseItemRowSchema = z
  .object({
    ...syncCols,
    purchase_id: id,
    line_no: z.number().int().min(1),
    variant_id: opt(id),
    raw_text: opt(text(300)),
    quantity: z.number().positive(),
    unit_price_cents: cents,
    gross_cents: cents,
    discount_cents: cents,
    final_cents: cents,
  })
  .refine((r) => r.final_cents === r.gross_cents - r.discount_cents, {
    message: 'final_cents debe ser gross_cents − discount_cents',
    path: ['final_cents'],
  });

export const ReceiptAliasRowSchema = z
  .object({
    ...syncCols,
    store_id: id,
    raw_text_norm: z.string().min(1).max(300),
    variant_id: id,
  })
  .refine((r) => normalizeReceiptText(r.raw_text_norm) === r.raw_text_norm, {
    message: 'raw_text_norm debe estar normalizado (09 §5.1)',
    path: ['raw_text_norm'],
  })
  .refine((r) => r.id === receiptAliasId(r.store_id, r.raw_text_norm), {
    message: 'El id debe ser uuidv5(store_id:raw_text_norm) (04 §2.1)',
    path: ['id'],
  });

export const PriceObservationRowSchema = z.object({
  ...syncCols,
  variant_id: id,
  store_id: id,
  branch_id: opt(id),
  listing_id: opt(id),
  source: z.enum(['shelf', 'web']),
  price_cents: cents,
  list_price_cents: opt(cents),
  effective_price_cents: opt(cents),
  in_stock: opt(bool01),
  promo_text: opt(text(300)),
  extra: opt(json(4000)),
  observed_at: ms,
  photo_image_id: opt(id),
});

// The three owner columns always travel (null or id) so "exactly one owner" can be checked.
export const PromotionRowSchema = z
  .object({
    ...syncCols,
    purchase_id: id.nullable(),
    purchase_item_id: id.nullable(),
    observation_id: id.nullable(),
    type: z.enum([
      'price_cut',
      'percent',
      'nxm',
      'nth_unit_discount',
      'member_price',
      'coupon',
      'msi',
      'bundle',
      'other',
    ]),
    params: opt(json(2000)),
    description: opt(text(300)),
    discount_cents: cents.optional(),
    affects_price: bool01.optional(),
  })
  .refine(
    (r) =>
      [r.purchase_id, r.purchase_item_id, r.observation_id].filter((owner) => owner !== null).length === 1,
    { message: 'Exactamente un dueño: compra, línea u observación', path: ['purchase_id'] },
  );

export const AlertRuleRowSchema = z
  .object({
    ...syncCols,
    user_id: id,
    variant_id: id,
    listing_id: opt(id),
    type: z.enum(['below_price', 'drop_pct', 'new_low', 'back_in_stock', 'promo']),
    threshold_cents: opt(cents),
    threshold_pct: opt(z.number().gt(0).max(100)),
    scope: z.enum(['listing', 'variant_web', 'variant_all']).optional(),
    cooldown_hours: z.number().int().min(0).max(720).optional(),
    active: bool01.optional(),
  })
  .refine((r) => r.type !== 'below_price' || r.threshold_cents != null, {
    message: 'below_price requiere threshold_cents',
    path: ['threshold_cents'],
  })
  .refine((r) => r.type !== 'drop_pct' || r.threshold_pct != null, {
    message: 'drop_pct requiere threshold_pct',
    path: ['threshold_pct'],
  });

// ---------- DOWN tables (only parsed by clients after pull)
const version = z.number().int().nonnegative();

export const UserRowSchema = z.object({
  id,
  username: z.string(),
  display_name: z.string(),
  role: z.enum(['admin', 'member']),
  active: bool01,
  updated_at: ms,
  version,
});

export const AgentStatusRowSchema = z.object({
  id: z.string(),
  last_heartbeat_at: ms.nullable(),
  agent_version: z.string().nullable(),
  info: z.string().nullable(),
  updated_at: ms,
  version,
});

export const ListingStateRowSchema = z.object({
  listing_id: id,
  last_checked_at: ms.nullable(),
  last_status: z.enum(['pending', 'ok', 'not_found', 'blocked', 'error']).nullable(),
  last_error: z.string().nullable(),
  consecutive_failures: z.number().int().nonnegative(),
  last_price_cents: cents.nullable(),
  last_list_price_cents: cents.nullable(),
  last_in_stock: bool01.nullable(),
  last_promo_text: z.string().nullable(),
  check_requested_at: ms.nullable(),
  updated_at: ms,
  version,
});

export const AlertEventRowSchema = z.object({
  id,
  rule_id: id,
  user_id: id,
  observation_id: id.nullable(),
  fired_at: ms,
  title: z.string(),
  body: z.string(),
  delivery_status: z.enum(['sent', 'partial', 'failed', 'no_devices']),
  version,
});

/** Schema of each table: for `sync` tables the push row (writable columns), for `down` the pulled row. */
export const ROW_SCHEMAS = {
  users: UserRowSchema,
  agent_status: AgentStatusRowSchema,
  stores: StoreRowSchema,
  categories: CategoryRowSchema,
  tags: TagRowSchema,
  store_branches: StoreBranchRowSchema,
  products: ProductRowSchema,
  variants: VariantRowSchema,
  product_tags: ProductTagRowSchema,
  barcodes: BarcodeRowSchema,
  images: ImageRowSchema,
  listings: ListingRowSchema,
  purchases: PurchaseRowSchema,
  listing_state: ListingStateRowSchema,
  image_renditions: ImageRenditionRowSchema,
  purchase_items: PurchaseItemRowSchema,
  receipt_aliases: ReceiptAliasRowSchema,
  price_observations: PriceObservationRowSchema,
  alert_rules: AlertRuleRowSchema,
  alert_events: AlertEventRowSchema,
  promotions: PromotionRowSchema,
} as const satisfies Record<TableName, z.ZodObject>;

export type StoreRow = z.infer<typeof StoreRowSchema>;
export type ProductRow = z.infer<typeof ProductRowSchema>;
export type VariantRow = z.infer<typeof VariantRowSchema>;
export type PurchaseRow = z.infer<typeof PurchaseRowSchema>;
export type PurchaseItemRow = z.infer<typeof PurchaseItemRowSchema>;
export type PromotionRow = z.infer<typeof PromotionRowSchema>;
