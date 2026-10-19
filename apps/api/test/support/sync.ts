import { env } from 'cloudflare:workers';
import { tablesInOrder } from '@maunedas/shared/sync/registry';
import { receiptAliasId, uuidv7 } from '@maunedas/shared/util/uuid';
import { createApp, type AppOptions } from '../../src/app';
import { clearUsers, createTestIssuer, insertUser, linkIdentity } from './firebase';

type Row = Record<string, unknown>;
/** A push mutation built by the helpers below (any column can be overridden). */
export type Mutation = { table: string; row: Row & { id: string; updated_at: number } };

export const DEVICE = '0192a5e9-0000-7000-8000-000000000001';
// Real user ids are UUIDv7 (alert_rules.user_id is validated as a UUID).
export const ADMIN_ID = '0192a5e9-0000-7000-8000-00000000a0a0';
export const MEMBER_ID = '0192a5e9-0000-7000-8000-00000000b0b0';

/** App with local test keys, an admin and a member, and their tokens. */
export async function syncHarness(options: Omit<AppOptions, 'firebaseKeys'> = {}) {
  const issuer = await createTestIssuer(env.FIREBASE_PROJECT_ID);
  const app = createApp({ ...options, firebaseKeys: issuer.keys });
  const tokens = {
    admin: await issuer.token({ sub: 'uid-admin' }),
    member: await issuer.token({ sub: 'uid-member' }),
  };

  async function reset() {
    // Children first; physical deletes are fine in a test database. Server tables that reference
    // synced rows or users go before them, users last.
    const db = env.DB;
    const serverChildren = [
      'user_identities',
      'devices',
      'image_jobs',
      'receipt_extractions',
      'ai_usage',
      'token_cache',
    ];
    await db.batch([
      ...serverChildren.map((t) => db.prepare(`DELETE FROM ${t}`)),
      ...[...tablesInOrder()]
        .reverse()
        .filter((t) => t !== 'users')
        .map((t) => db.prepare(`DELETE FROM ${t}`)),
      db.prepare(`UPDATE sync_meta SET value = 0 WHERE key = 'version'`),
    ]);
    await clearUsers(db);
    await insertUser(db, { id: ADMIN_ID, username: 'mau', role: 'admin' });
    await insertUser(db, { id: MEMBER_ID, username: 'pepe', role: 'member' });
    await linkIdentity(db, 'uid-admin', ADMIN_ID);
    await linkIdentity(db, 'uid-member', MEMBER_ID);
  }

  async function push(
    mutations: Array<{ table: string; row: Row }>,
    as: 'admin' | 'member' = 'member',
    headers: Record<string, string> = {},
  ) {
    return app.request(
      '/v1/sync/push',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Schema': '1',
          Authorization: `Bearer ${tokens[as]}`,
          ...headers,
        },
        body: JSON.stringify({ device_id: DEVICE, mutations }),
      },
      env as never,
    );
  }

  async function pull(body: Record<string, unknown> = {}, as: 'admin' | 'member' = 'member') {
    return app.request(
      '/v1/sync/pull',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Schema': '1',
          Authorization: `Bearer ${tokens[as]}`,
        },
        body: JSON.stringify(body),
      },
      env as never,
    );
  }

  return { app, tokens, reset, push, pull };
}

export interface PullBody {
  changes: Record<string, Row[]>;
  cursors: Record<string, [number, string]>;
  has_more: boolean;
  server_time: number;
  schema_version: number;
}

export interface PushBody {
  applied: number;
  skipped: number;
  conflicts: Array<{
    table: string;
    id: string;
    reason: string;
    server_row: Row | null;
    details?: Record<string, unknown>;
  }>;
}

export async function rowOf(table: string, id: string): Promise<Row | null> {
  return env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?1`).bind(id).first<Row>();
}

export async function syncVersion(): Promise<number> {
  return (await env.DB.prepare(`SELECT value FROM sync_meta WHERE key = 'version'`).first<{
    value: number;
  }>())!.value;
}

// ---------- Valid rows (override any column)
let clock = 1_790_000_000_000;
/** Strictly increasing client timestamps in the past, so the 5-minute clamp never interferes. */
export const t = () => (clock += 1000);

const meta = (extra: Row = {}) => {
  const now = t();
  return { id: uuidv7(), created_at: now, updated_at: now, deleted_at: null, ...extra };
};

export const store = (o: Row = {}): Mutation => ({
  table: 'stores',
  row: { ...meta(), name: 'Tienda', kind: 'physical', ...o },
});
export const product = (o: Row = {}): Mutation => ({
  table: 'products',
  row: { ...meta(), name: 'Leche Lala Entera', ...o },
});
export const variant = (productId: string, o: Row = {}): Mutation => ({
  table: 'variants',
  row: {
    ...meta(),
    product_id: productId,
    label: '1 L',
    measure: 'volume',
    unit_amount: 1000,
    pack_count: 1,
    ...o,
  },
});
export const barcode = (variantId: string, code: string, o: Row = {}): Mutation => ({
  table: 'barcodes',
  row: { ...meta(), variant_id: variantId, code, source: 'scan', ...o },
});
export const purchase = (storeId: string, o: Row = {}): Mutation => ({
  table: 'purchases',
  row: { ...meta(), store_id: storeId, purchased_at: t(), source: 'manual', ...o },
});
export const item = (purchaseId: string, variantId: string | null, o: Row = {}): Mutation => ({
  table: 'purchase_items',
  row: {
    ...meta(),
    purchase_id: purchaseId,
    line_no: 1,
    variant_id: variantId,
    quantity: 1,
    unit_price_cents: 2850,
    gross_cents: 2850,
    discount_cents: 0,
    final_cents: 2850,
    ...o,
  },
});
export const image = (ownerId: string, o: Row = {}): Mutation => ({
  table: 'images',
  row: { ...meta(), owner_type: 'product', owner_id: ownerId, role: 'catalog', source: 'user', ...o },
});
export function rendition(imageId: string, o: Row = {}): Mutation {
  const m = meta();
  return {
    table: 'image_renditions',
    row: {
      ...m,
      image_id: imageId,
      kind: 'thumb',
      tier: 'device',
      r2_key: `images/${imageId}/${m.id}.webp`,
      ...o,
    },
  };
}
export const observation = (variantId: string, storeId: string, o: Row = {}): Mutation => ({
  table: 'price_observations',
  row: {
    ...meta(),
    variant_id: variantId,
    store_id: storeId,
    source: 'shelf',
    price_cents: 2850,
    observed_at: t(),
    ...o,
  },
});
export const alertRule = (variantId: string, o: Row = {}): Mutation => ({
  table: 'alert_rules',
  row: {
    ...meta(),
    user_id: 'ignored',
    variant_id: variantId,
    type: 'below_price',
    threshold_cents: 2500,
    ...o,
  },
});
export function alias(storeId: string, variantId: string, text: string, o: Row = {}): Mutation {
  return {
    table: 'receipt_aliases',
    row: {
      ...meta(),
      id: receiptAliasId(storeId, text),
      store_id: storeId,
      raw_text_norm: text,
      variant_id: variantId,
      ...o,
    },
  };
}

/** A later edit of the same row (new updated_at). */
export const edit = (m: Mutation, changes: Row = {}): Mutation => ({
  ...m,
  row: { ...m.row, updated_at: t(), ...changes },
});
