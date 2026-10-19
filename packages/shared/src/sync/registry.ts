// Single source of the synced tables (04 §2). The Worker uses it for push/pull; Android copies it to
// core/sync/SyncTables.kt. apps/api/test/registry.test.ts compares it against the migrated D1 schema.
import { searchKey } from '../text/searchKey';

export type SyncMode = 'sync' | 'down';
export type TableScope = 'household' | 'user';
export type UniqueConflict = 'BARCODE_TAKEN' | 'ALIAS_TAKEN';
export type Row = Record<string, unknown>;

export interface TableSpec {
  mode: SyncMode;
  /** Push and pull process tables by ascending order: parents before children (foreign keys). */
  order: number;
  pk: string;
  /** Columns sent in pull. */
  columns: readonly string[];
  /** Columns accepted in push (never `version`). Only `sync` tables. */
  writable?: readonly string[];
  scope: TableScope;
  /** Tombstones only by an admin. */
  adminDelete?: boolean;
  /** An existing row only accepts a change of `deleted_at`. */
  appendOnly?: boolean;
  /** Partial unique index among live rows (`deleted_at IS NULL`) and the conflict it raises. */
  uniqueLive?: { columns: readonly string[]; conflict: UniqueConflict };
  /** Derived columns the server recomputes on push. */
  derive?: (row: Row) => Row;
  /** Foreign keys: column → referenced table (its primary key). Push checks them before writing (04 §3.2). */
  refs?: Readonly<Record<string, string>>;
}

type Extra = Omit<TableSpec, 'mode' | 'order' | 'pk' | 'columns' | 'writable' | 'scope'> & {
  scope?: TableScope;
};

const SYNC_COLS = ['created_at', 'updated_at', 'deleted_at', 'updated_by'] as const;

/** A `sync` table: every column travels in pull; push accepts all of them except `version`. */
function syncTable(order: number, columns: readonly string[], extra: Extra = {}): TableSpec {
  const writable = ['id', ...columns, ...SYNC_COLS];
  return {
    mode: 'sync',
    order,
    pk: 'id',
    scope: 'household',
    ...extra,
    writable,
    columns: [...writable, 'version'],
  };
}

function downTable(order: number, pk: string, columns: readonly string[], extra: Extra = {}): TableSpec {
  return { mode: 'down', order, pk, scope: 'household', ...extra, columns };
}

export const TABLES = {
  // Only these user columns reach clients (never google_email nor created_at).
  users: downTable(5, 'id', ['id', 'username', 'display_name', 'role', 'active', 'updated_at', 'version']),
  agent_status: downTable(5, 'id', [
    'id',
    'last_heartbeat_at',
    'agent_version',
    'info',
    'updated_at',
    'version',
  ]),

  stores: syncTable(10, ['name', 'chain', 'kind', 'website', 'adapter', 'default_check_interval_min'], {
    adminDelete: true,
  }),
  categories: syncTable(10, ['parent_id', 'name', 'sort_order'], {
    adminDelete: true,
    refs: { parent_id: 'categories' },
  }),
  tags: syncTable(10, ['name']),

  store_branches: syncTable(20, ['store_id', 'name', 'city', 'address', 'lat', 'lng'], {
    refs: { store_id: 'stores' },
  }),
  products: syncTable(
    20,
    ['name', 'brand', 'category_id', 'display_unit', 'notes', 'primary_image_id', 'search_key'],
    {
      adminDelete: true,
      derive: (r) => ({ ...r, search_key: searchKey(`${String(r.name ?? '')} ${String(r.brand ?? '')}`) }),
      refs: { category_id: 'categories' },
    },
  ),

  variants: syncTable(
    30,
    ['product_id', 'label', 'measure', 'unit_amount', 'pack_count', 'sold_by_weight', 'primary_image_id'],
    { adminDelete: true, refs: { product_id: 'products' } },
  ),
  product_tags: syncTable(30, ['product_id', 'tag_id'], { refs: { product_id: 'products', tag_id: 'tags' } }),

  barcodes: syncTable(40, ['variant_id', 'code', 'format', 'source'], {
    uniqueLive: { columns: ['code'], conflict: 'BARCODE_TAKEN' },
    refs: { variant_id: 'variants' },
  }),
  images: syncTable(40, [
    'owner_type',
    'owner_id',
    'role',
    'source',
    'license',
    'attribution',
    'source_url',
    'original_key',
    'selected_processed_id',
    'selected_thumb_id',
    'edit_params',
    'enhance_requested_at',
  ]),
  listings: syncTable(
    40,
    [
      'variant_id',
      'store_id',
      'adapter',
      'url',
      'canonical_url',
      'external_id',
      'check_interval_min',
      'active',
    ],
    { refs: { variant_id: 'variants', store_id: 'stores' } },
  ),
  purchases: syncTable(
    40,
    [
      'store_id',
      'branch_id',
      'purchased_at',
      'currency',
      'subtotal_cents',
      'discount_cents',
      'total_cents',
      'source',
      'status',
      'receipt_image_id',
      'notes',
    ],
    { refs: { store_id: 'stores', branch_id: 'store_branches' } },
  ),

  listing_state: downTable(
    45,
    'listing_id',
    [
      'listing_id',
      'last_checked_at',
      'last_status',
      'last_error',
      'consecutive_failures',
      'last_price_cents',
      'last_list_price_cents',
      'last_in_stock',
      'last_promo_text',
      'check_requested_at',
      'updated_at',
      'version',
    ],
    { refs: { listing_id: 'listings' } },
  ),

  image_renditions: syncTable(50, ['image_id', 'kind', 'tier', 'r2_key', 'width', 'height', 'bytes'], {
    appendOnly: true,
    refs: { image_id: 'images' },
  }),
  purchase_items: syncTable(
    50,
    [
      'purchase_id',
      'line_no',
      'variant_id',
      'raw_text',
      'quantity',
      'unit_price_cents',
      'gross_cents',
      'discount_cents',
      'final_cents',
    ],
    { refs: { purchase_id: 'purchases', variant_id: 'variants' } },
  ),
  receipt_aliases: syncTable(50, ['store_id', 'raw_text_norm', 'variant_id'], {
    uniqueLive: { columns: ['store_id', 'raw_text_norm'], conflict: 'ALIAS_TAKEN' },
    refs: { store_id: 'stores', variant_id: 'variants' },
  }),
  price_observations: syncTable(
    50,
    [
      'variant_id',
      'store_id',
      'branch_id',
      'listing_id',
      'source',
      'price_cents',
      'list_price_cents',
      'effective_price_cents',
      'in_stock',
      'promo_text',
      'extra',
      'observed_at',
      'photo_image_id',
    ],
    {
      refs: {
        variant_id: 'variants',
        store_id: 'stores',
        branch_id: 'store_branches',
        listing_id: 'listings',
      },
    },
  ),
  alert_rules: syncTable(
    50,
    [
      'user_id',
      'variant_id',
      'listing_id',
      'type',
      'threshold_cents',
      'threshold_pct',
      'scope',
      'cooldown_hours',
      'active',
    ],
    { scope: 'user', refs: { user_id: 'users', variant_id: 'variants', listing_id: 'listings' } },
  ),

  alert_events: downTable(
    55,
    'id',
    ['id', 'rule_id', 'user_id', 'observation_id', 'fired_at', 'title', 'body', 'delivery_status', 'version'],
    {
      scope: 'user',
      refs: { rule_id: 'alert_rules', user_id: 'users', observation_id: 'price_observations' },
    },
  ),

  promotions: syncTable(
    60,
    [
      'purchase_id',
      'purchase_item_id',
      'observation_id',
      'type',
      'params',
      'description',
      'discount_cents',
      'affects_price',
    ],
    {
      refs: {
        purchase_id: 'purchases',
        purchase_item_id: 'purchase_items',
        observation_id: 'price_observations',
      },
    },
  ),
} as const satisfies Record<string, TableSpec>;

export type TableName = keyof typeof TABLES;

export const TABLE_NAMES = Object.keys(TABLES) as TableName[];

export function isTableName(name: string): name is TableName {
  return Object.hasOwn(TABLES, name);
}

/** Tables by processing order; ties keep declaration order. */
export function tablesInOrder(): TableName[] {
  return [...TABLE_NAMES].sort((a, b) => TABLES[a].order - TABLES[b].order);
}

/** Column holding the owner of user-scoped tables. */
export const USER_COLUMN = 'user_id';
