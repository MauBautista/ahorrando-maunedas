// Typed view of docs/esquema-d1.sql for Drizzle queries. The SQL migrations in ../../migrations are the
// source of truth (hand-written: Drizzle cannot express COLLATE NOCASE, partial unique indexes and CHECKs
// faithfully). test/schema.test.ts fails if a column here differs from the migrated database.
import { integer, real, sqliteTable, sqliteView, text } from 'drizzle-orm/sqlite-core';

const syncColumns = {
  created_at: integer().notNull(),
  updated_at: integer().notNull(),
  deleted_at: integer(),
  updated_by: text(),
  version: integer().notNull().default(0),
};

// ---------- Sync infrastructure (SERVER)
export const syncMeta = sqliteTable('sync_meta', {
  key: text().primaryKey(),
  value: integer().notNull(),
});

// ---------- Users, identities and devices
export const users = sqliteTable('users', {
  id: text().primaryKey(),
  username: text().notNull(),
  display_name: text().notNull(),
  google_email: text(),
  role: text({ enum: ['admin', 'member'] }).notNull(),
  active: integer().notNull().default(1),
  created_at: integer().notNull(),
  updated_at: integer().notNull(),
  version: integer().notNull().default(0),
});

export const userIdentities = sqliteTable('user_identities', {
  firebase_uid: text().primaryKey(),
  user_id: text().notNull(),
  provider: text({ enum: ['password', 'google.com'] }).notNull(),
  created_at: integer().notNull(),
});

export const devices = sqliteTable('devices', {
  id: text().primaryKey(),
  user_id: text().notNull(),
  platform: text({ enum: ['android', 'web'] }).notNull(),
  fcm_token: text(),
  app_version: text(),
  last_seen_at: integer(),
  created_at: integer().notNull(),
});

// ---------- Stores (SYNC)
export const stores = sqliteTable('stores', {
  id: text().primaryKey(),
  name: text().notNull(),
  chain: text(),
  kind: text({ enum: ['physical', 'online', 'both'] }).notNull(),
  website: text(),
  adapter: text(),
  default_check_interval_min: integer().notNull().default(480),
  ...syncColumns,
});

export const storeBranches = sqliteTable('store_branches', {
  id: text().primaryKey(),
  store_id: text().notNull(),
  name: text().notNull(),
  city: text(),
  address: text(),
  lat: real(),
  lng: real(),
  ...syncColumns,
});

// ---------- Catalog (SYNC)
export const categories = sqliteTable('categories', {
  id: text().primaryKey(),
  parent_id: text(),
  name: text().notNull(),
  sort_order: integer().notNull().default(0),
  ...syncColumns,
});

export const tags = sqliteTable('tags', {
  id: text().primaryKey(),
  name: text().notNull(),
  ...syncColumns,
});

export const products = sqliteTable('products', {
  id: text().primaryKey(),
  name: text().notNull(),
  brand: text(),
  category_id: text(),
  display_unit: text({ enum: ['kg', '100g', 'L', '100ml', 'pz'] })
    .notNull()
    .default('pz'),
  notes: text(),
  primary_image_id: text(),
  search_key: text().notNull().default(''),
  ...syncColumns,
});

export const productTags = sqliteTable('product_tags', {
  id: text().primaryKey(),
  product_id: text().notNull(),
  tag_id: text().notNull(),
  ...syncColumns,
});

export const variants = sqliteTable('variants', {
  id: text().primaryKey(),
  product_id: text().notNull(),
  label: text().notNull(),
  measure: text({ enum: ['mass', 'volume', 'count'] }).notNull(),
  unit_amount: real().notNull(),
  pack_count: integer().notNull().default(1),
  sold_by_weight: integer().notNull().default(0),
  primary_image_id: text(),
  ...syncColumns,
});

export const barcodes = sqliteTable('barcodes', {
  id: text().primaryKey(),
  variant_id: text().notNull(),
  code: text().notNull(),
  format: text(),
  source: text({ enum: ['scan', 'off', 'manual', 'receipt'] }).notNull(),
  ...syncColumns,
});

// ---------- Images
export const images = sqliteTable('images', {
  id: text().primaryKey(),
  owner_type: text({ enum: ['product', 'variant', 'purchase', 'observation'] }).notNull(),
  owner_id: text().notNull(),
  role: text({ enum: ['catalog', 'receipt', 'shelf_photo'] }).notNull(),
  source: text({ enum: ['user', 'off', 'generated'] }).notNull(),
  license: text(),
  attribution: text(),
  source_url: text(),
  original_key: text(),
  selected_processed_id: text(),
  selected_thumb_id: text(),
  edit_params: text(),
  enhance_requested_at: integer(),
  ...syncColumns,
});

export const imageRenditions = sqliteTable('image_renditions', {
  id: text().primaryKey(),
  image_id: text().notNull(),
  kind: text({ enum: ['mask', 'processed', 'thumb'] }).notNull(),
  tier: text({ enum: ['catalog', 'device', 'home', 'ai', 'manual'] }).notNull(),
  r2_key: text().notNull(),
  width: integer(),
  height: integer(),
  bytes: integer(),
  ...syncColumns,
});

export const imageJobs = sqliteTable('image_jobs', {
  id: text().primaryKey(),
  image_id: text().notNull(),
  op: text({ enum: ['remove_bg'] }).notNull(),
  status: text({ enum: ['queued', 'claimed', 'done', 'failed'] }).notNull(),
  attempts: integer().notNull().default(0),
  claimed_at: integer(),
  error: text(),
  created_at: integer().notNull(),
  updated_at: integer().notNull(),
});

// ---------- Purchases (SYNC)
export const purchases = sqliteTable('purchases', {
  id: text().primaryKey(),
  store_id: text().notNull(),
  branch_id: text(),
  purchased_at: integer().notNull(),
  currency: text().notNull().default('MXN'),
  subtotal_cents: integer(),
  discount_cents: integer().notNull().default(0),
  total_cents: integer(),
  source: text({ enum: ['manual', 'receipt_ai', 'receipt_ocr', 'email', 'cfdi', 'import'] }).notNull(),
  status: text({ enum: ['draft', 'confirmed'] })
    .notNull()
    .default('draft'),
  receipt_image_id: text(),
  notes: text(),
  ...syncColumns,
});

export const purchaseItems = sqliteTable('purchase_items', {
  id: text().primaryKey(),
  purchase_id: text().notNull(),
  line_no: integer().notNull(),
  variant_id: text(),
  raw_text: text(),
  quantity: real().notNull(),
  unit_price_cents: integer().notNull(),
  gross_cents: integer().notNull(),
  discount_cents: integer().notNull().default(0),
  final_cents: integer().notNull(),
  ...syncColumns,
});

export const receiptAliases = sqliteTable('receipt_aliases', {
  id: text().primaryKey(),
  store_id: text().notNull(),
  raw_text_norm: text().notNull(),
  variant_id: text().notNull(),
  ...syncColumns,
});

export const receiptExtractions = sqliteTable('receipt_extractions', {
  id: text().primaryKey(),
  image_ids: text().notNull(),
  images_key: text().notNull(),
  requested_by: text(),
  purchase_id: text(),
  provider: text().notNull(),
  model: text().notNull(),
  status: text({ enum: ['ok', 'failed', 'budget_exceeded'] }).notNull(),
  result_json: text(),
  cost_usd_micros: integer(),
  created_at: integer().notNull(),
});

// ---------- Price tracker
export const listings = sqliteTable('listings', {
  id: text().primaryKey(),
  variant_id: text().notNull(),
  store_id: text().notNull(),
  adapter: text().notNull(),
  url: text().notNull(),
  canonical_url: text(),
  external_id: text(),
  check_interval_min: integer(),
  active: integer().notNull().default(1),
  ...syncColumns,
});

export const listingState = sqliteTable('listing_state', {
  listing_id: text().primaryKey(),
  last_checked_at: integer(),
  last_status: text({ enum: ['pending', 'ok', 'not_found', 'blocked', 'error'] }),
  last_error: text(),
  consecutive_failures: integer().notNull().default(0),
  last_price_cents: integer(),
  last_list_price_cents: integer(),
  last_in_stock: integer(),
  last_promo_text: text(),
  check_requested_at: integer(),
  updated_at: integer().notNull(),
  version: integer().notNull().default(0),
});

export const priceObservations = sqliteTable('price_observations', {
  id: text().primaryKey(),
  variant_id: text().notNull(),
  store_id: text().notNull(),
  branch_id: text(),
  listing_id: text(),
  source: text({ enum: ['shelf', 'web'] }).notNull(),
  price_cents: integer().notNull(),
  list_price_cents: integer(),
  effective_price_cents: integer(),
  in_stock: integer(),
  promo_text: text(),
  extra: text(),
  observed_at: integer().notNull(),
  photo_image_id: text(),
  ...syncColumns,
});

export const promotions = sqliteTable('promotions', {
  id: text().primaryKey(),
  purchase_id: text(),
  purchase_item_id: text(),
  observation_id: text(),
  type: text({
    enum: [
      'price_cut',
      'percent',
      'nxm',
      'nth_unit_discount',
      'member_price',
      'coupon',
      'msi',
      'bundle',
      'other',
    ],
  }).notNull(),
  params: text(),
  description: text(),
  discount_cents: integer().notNull().default(0),
  affects_price: integer().notNull().default(1),
  ...syncColumns,
});

// ---------- Alerts
export const alertRules = sqliteTable('alert_rules', {
  id: text().primaryKey(),
  user_id: text().notNull(),
  variant_id: text().notNull(),
  listing_id: text(),
  type: text({ enum: ['below_price', 'drop_pct', 'new_low', 'back_in_stock', 'promo'] }).notNull(),
  threshold_cents: integer(),
  threshold_pct: real(),
  scope: text({ enum: ['listing', 'variant_web', 'variant_all'] })
    .notNull()
    .default('variant_web'),
  cooldown_hours: integer().notNull().default(24),
  active: integer().notNull().default(1),
  ...syncColumns,
});

export const alertEvents = sqliteTable('alert_events', {
  id: text().primaryKey(),
  rule_id: text().notNull(),
  user_id: text().notNull(),
  observation_id: text(),
  fired_at: integer().notNull(),
  title: text().notNull(),
  body: text().notNull(),
  delivery_status: text({ enum: ['sent', 'partial', 'failed', 'no_devices'] }).notNull(),
  version: integer().notNull().default(0),
});

// ---------- Home agent, AI and caches
export const agentStatus = sqliteTable('agent_status', {
  id: text().primaryKey(),
  last_heartbeat_at: integer(),
  agent_version: text(),
  info: text(),
  updated_at: integer().notNull(),
  version: integer().notNull().default(0),
});

export const aiUsage = sqliteTable('ai_usage', {
  id: text().primaryKey(),
  purpose: text({ enum: ['receipt', 'image_edit', 'other'] }).notNull(),
  provider: text().notNull(),
  model: text().notNull(),
  user_id: text(),
  input_tokens: integer(),
  output_tokens: integer(),
  cost_usd_micros: integer().notNull(),
  created_at: integer().notNull(),
});

export const offCache = sqliteTable('off_cache', {
  code: text().primaryKey(),
  found: integer().notNull(),
  source: text({ enum: ['off', 'opf', 'obf'] }),
  payload: text(),
  fetched_at: integer().notNull(),
});

export const tokenCache = sqliteTable('token_cache', {
  key: text().primaryKey(),
  value: text().notNull(),
  expires_at: integer().notNull(),
});

// ---------- Unified price points (VIEW, defined in the migration)
export const vPricePoints = sqliteView('v_price_points', {
  source: text({ enum: ['purchase', 'shelf', 'web'] }).notNull(),
  point_id: text().notNull(),
  variant_id: text().notNull(),
  store_id: text().notNull(),
  branch_id: text(),
  listing_id: text(),
  observed_at: integer().notNull(),
  list_unit_cents: integer().notNull(),
  effective_unit_cents: integer().notNull(),
  cents_per_base: real().notNull(),
  has_promo: integer().notNull(),
}).existing();

/** Every table of the schema, by SQL name, for the column-parity test. */
export const TABLES = {
  sync_meta: syncMeta,
  users,
  user_identities: userIdentities,
  devices,
  stores,
  store_branches: storeBranches,
  categories,
  tags,
  products,
  product_tags: productTags,
  variants,
  barcodes,
  images,
  image_renditions: imageRenditions,
  image_jobs: imageJobs,
  purchases,
  purchase_items: purchaseItems,
  receipt_aliases: receiptAliases,
  receipt_extractions: receiptExtractions,
  listings,
  listing_state: listingState,
  price_observations: priceObservations,
  promotions,
  alert_rules: alertRules,
  alert_events: alertEvents,
  agent_status: agentStatus,
  ai_usage: aiUsage,
  off_cache: offCache,
  token_cache: tokenCache,
} as const;
