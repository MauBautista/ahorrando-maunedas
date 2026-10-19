import { env } from 'cloudflare:workers';
import { productTagId, uuidv7 } from '@maunedas/shared/util/uuid';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { VARIANT_REFERENCES } from '../src/db/queries/merge';
import {
  ADMIN_ID,
  alertRule,
  alias,
  barcode,
  edit,
  image,
  item,
  observation,
  product,
  purchase,
  store,
  syncHarness,
  t,
  variant,
  type Mutation,
} from './support/sync';

let h: Awaited<ReturnType<typeof syncHarness>>;

beforeAll(async () => {
  h = await syncHarness();
});

async function push(mutations: Mutation[], as: 'admin' | 'member' = 'member') {
  const res = await h.push(mutations, as);
  const body = await res.json<{ conflicts: unknown[] }>();
  expect(res.status, JSON.stringify(body)).toBe(200);
  expect(body.conflicts).toEqual([]);
}

async function merge(body: Record<string, unknown>, as: 'admin' | 'member' = 'admin') {
  const res = await h.app.request(
    '/v1/admin/merge',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${h.tokens[as]}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    env as never,
  );
  return {
    status: res.status,
    body: await res.json<{
      moved?: Record<string, number>;
      error?: { code: string; details?: { reason?: string } };
    }>(),
  };
}

const version = async () =>
  Number(await env.DB.prepare(`SELECT value FROM sync_meta WHERE key = 'version'`).first('value'));
const rowsOf = (table: string, ids: string[]) =>
  env.DB.prepare(`SELECT * FROM ${table} WHERE id IN (SELECT value FROM json_each(?1)) ORDER BY id`)
    .bind(JSON.stringify(ids))
    .all<Record<string, unknown>>()
    .then((r) => r.results);

let fx: Record<string, Mutation>;
let listingId: string;
let webObservationId: string;

beforeEach(async () => {
  await h.reset();
  const shop = store({ name: 'Walmart' });
  const duplicate = product({ name: 'Leche Lala' });
  const original = product({ name: 'Leche Lala Entera' });
  const src = variant(duplicate.row.id, { label: '1 L' });
  const gone = variant(duplicate.row.id, { label: '2 L', unit_amount: 2000 });
  const tgt = variant(original.row.id, { label: '1 L' });
  const kilo = variant(original.row.id, { label: '1 kg', measure: 'mass' });
  const basicos = { table: 'tags', row: { id: uuidv7(), created_at: t(), updated_at: t(), name: 'Básicos' } };
  const lacteos = { table: 'tags', row: { id: uuidv7(), created_at: t(), updated_at: t(), name: 'Lácteos' } };
  const link = (productId: string, tagId: string): Mutation => ({
    table: 'product_tags',
    row: {
      id: productTagId(productId, tagId),
      created_at: t(),
      updated_at: t(),
      product_id: productId,
      tag_id: tagId,
    },
  });
  const dupBasicos = link(duplicate.row.id, basicos.row.id);
  const dupLacteos = link(duplicate.row.id, lacteos.row.id);
  const origBasicos = link(original.row.id, basicos.row.id);
  const origLacteos = link(original.row.id, lacteos.row.id);
  const buy = purchase(shop.row.id, { status: 'confirmed', purchased_at: Date.now() - 86_400_000 });
  const variantPhoto = image(src.row.id, { owner_type: 'variant' });
  const productPhoto = image(duplicate.row.id);
  const oldCode = barcode(src.row.id, '7501020515343');
  await push([
    shop,
    duplicate,
    original,
    src,
    gone,
    tgt,
    kilo,
    basicos,
    lacteos,
    dupBasicos,
    dupLacteos,
    origBasicos,
    origLacteos,
  ]);
  await push([
    barcode(src.row.id, '7501020515350'),
    oldCode,
    buy,
    item(buy.row.id, src.row.id),
    observation(src.row.id, shop.row.id, { price_cents: 2700 }),
    alertRule(src.row.id),
    alias(shop.row.id, src.row.id, 'LCH LALA 1L'),
    variantPhoto,
    productPhoto,
    edit(src, { primary_image_id: variantPhoto.row.id }),
    edit(duplicate, { primary_image_id: productPhoto.row.id }),
  ]);
  await push([edit(oldCode, { deleted_at: t() }), edit(origLacteos, { deleted_at: t() })]);
  await push([edit(gone, { deleted_at: t() })], 'admin');

  listingId = uuidv7();
  webObservationId = uuidv7();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO listings (id, variant_id, store_id, adapter, url, created_at, updated_at)
       VALUES (?1, ?2, ?3, 'amazon_mx', 'https://www.amazon.com.mx/dp/B000000001', 1, 1)`,
    ).bind(listingId, src.row.id, shop.row.id),
    env.DB.prepare(
      `INSERT INTO price_observations (id, variant_id, store_id, listing_id, source, price_cents, observed_at, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, 'web', 2600, ?5, ?5, ?5)`,
    ).bind(webObservationId, src.row.id, shop.row.id, listingId, Date.now() - 3_600_000),
  ]);
  fx = {
    shop,
    duplicate,
    original,
    src,
    gone,
    tgt,
    kilo,
    basicos,
    lacteos,
    origBasicos,
    origLacteos,
    variantPhoto,
    productPhoto,
  };
});

describe('POST /v1/admin/merge — variant (03 §12, 11 §3)', () => {
  it('moves every reference to the target, tombstones the source and gives all of them the new version', async () => {
    const before = await version();
    const { status, body } = await merge({
      kind: 'variant',
      source_id: fx.src!.row.id,
      target_id: fx.tgt!.row.id,
    });
    expect(status).toBe(200);
    expect(body.moved).toEqual({
      barcodes: 2,
      purchase_items: 1,
      price_observations: 2,
      listings: 1,
      alert_rules: 1,
      receipt_aliases: 1,
      images: 1,
    });
    expect(await version()).toBe(before + 1);

    for (const table of VARIANT_REFERENCES) {
      const { results } = await env.DB.prepare(`SELECT variant_id, version, updated_by FROM ${table}`).all();
      expect(results.length, table).toBeGreaterThan(0);
      for (const row of results) {
        expect(row, table).toEqual({ variant_id: fx.tgt!.row.id, version: before + 1, updated_by: ADMIN_ID });
      }
    }
    const [photo] = await rowsOf('images', [fx.variantPhoto!.row.id]);
    expect(photo).toMatchObject({ owner_id: fx.tgt!.row.id, version: before + 1 });
    const [src] = await rowsOf('variants', [fx.src!.row.id]);
    expect(src).toMatchObject({ version: before + 1, updated_by: ADMIN_ID });
    expect(src!.deleted_at).toEqual(expect.any(Number));
    // The target had no photo: it takes the source's.
    const [tgt] = await rowsOf('variants', [fx.tgt!.row.id]);
    expect(tgt).toMatchObject({ primary_image_id: fx.variantPhoto!.row.id, version: before + 1 });
  });

  it('the histories are joined and clients receive the changes by pull', async () => {
    const before = await version();
    await merge({ kind: 'variant', source_id: fx.src!.row.id, target_id: fx.tgt!.row.id });
    const history = await h.app.request(
      `/v1/variants/${fx.tgt!.row.id}/history`,
      { headers: { Authorization: `Bearer ${h.tokens.member}` } },
      env as never,
    );
    const points = (await history.json<{ points: Array<{ source: string }> }>()).points;
    expect(points.map((p) => p.source).sort()).toEqual(['purchase', 'shelf', 'web']);

    // A cursor past every row of `before`: only what the merge wrote comes down.
    const res = await h.pull({
      cursors: { barcodes: [before, '~'], variants: [before, '~'] },
      tables: ['barcodes', 'variants'],
    });
    const pulled = await res.json<{ changes: Record<string, Array<{ id: string }>> }>();
    expect(pulled.changes.barcodes).toHaveLength(2);
    expect(pulled.changes.variants?.map((v) => v.id).sort()).toEqual([fx.src!.row.id, fx.tgt!.row.id].sort());
  });

  it('measures must match', async () => {
    const before = await version();
    const { status, body } = await merge({
      kind: 'variant',
      source_id: fx.src!.row.id,
      target_id: fx.kilo!.row.id,
    });
    expect(status).toBe(409);
    expect(body.error).toMatchObject({ code: 'MERGE_INVALID', details: { reason: 'MEASURE_MISMATCH' } });
    expect(await version()).toBe(before);
  });
});

describe('POST /v1/admin/merge — product (03 §12)', () => {
  it('moves the variants and photos, unites tags without live duplicates and tombstones the source', async () => {
    const before = await version();
    const { status, body } = await merge({
      kind: 'product',
      source_id: fx.duplicate!.row.id,
      target_id: fx.original!.row.id,
    });
    expect(status).toBe(200);
    expect(body.moved).toEqual({ variants: 2, images: 1, product_tags: 2 });

    const variants = await rowsOf('variants', [fx.src!.row.id, fx.gone!.row.id]);
    for (const v of variants)
      expect(v).toMatchObject({ product_id: fx.original!.row.id, version: before + 1 });

    const { results: links } = await env.DB.prepare(
      'SELECT id, product_id, tag_id, deleted_at, version FROM product_tags ORDER BY product_id, tag_id',
    ).all<{ id: string; product_id: string; deleted_at: number | null; version: number }>();
    const live = links.filter((l) => l.deleted_at === null);
    expect(live.map((l) => l.product_id)).toEqual([fx.original!.row.id, fx.original!.row.id]);
    expect(live.map((l) => l.id).sort()).toEqual([fx.origBasicos!.row.id, fx.origLacteos!.row.id].sort());
    // The already live link is left alone; the deleted one is revived with the new version.
    const basicos = links.find((l) => l.id === fx.origBasicos!.row.id)!;
    const lacteos = links.find((l) => l.id === fx.origLacteos!.row.id)!;
    expect(basicos.version).toBeLessThan(before + 1);
    expect(lacteos.version).toBe(before + 1);
    expect(
      links.filter((l) => l.product_id === fx.duplicate!.row.id).every((l) => l.deleted_at !== null),
    ).toBe(true);

    const [photo] = await rowsOf('images', [fx.productPhoto!.row.id]);
    expect(photo).toMatchObject({ owner_id: fx.original!.row.id });
    const [original] = await rowsOf('products', [fx.original!.row.id]);
    expect(original).toMatchObject({ primary_image_id: fx.productPhoto!.row.id, deleted_at: null });
    const [duplicate] = await rowsOf('products', [fx.duplicate!.row.id]);
    expect(duplicate!.deleted_at).toEqual(expect.any(Number));
  });

  it('a target that already has a photo keeps it', async () => {
    const own = image(fx.original!.row.id);
    await push([own, edit(fx.original!, { primary_image_id: own.row.id })]);
    await merge({ kind: 'product', source_id: fx.duplicate!.row.id, target_id: fx.original!.row.id });
    const [original] = await rowsOf('products', [fx.original!.row.id]);
    expect(original!.primary_image_id).toBe(own.row.id);
  });
});

describe('POST /v1/admin/merge — rejections', () => {
  it('the same row, a deleted one, an unknown one or a bad body', async () => {
    const before = await version();
    const same = await merge({
      kind: 'product',
      source_id: fx.original!.row.id,
      target_id: fx.original!.row.id,
    });
    expect(same.status).toBe(409);
    expect(same.body.error?.details?.reason).toBe('SAME');
    const deleted = await merge({ kind: 'variant', source_id: fx.gone!.row.id, target_id: fx.tgt!.row.id });
    expect(deleted.status).toBe(409);
    expect(deleted.body.error?.details?.reason).toBe('DELETED');
    const deletedTarget = await merge({
      kind: 'variant',
      source_id: fx.tgt!.row.id,
      target_id: fx.gone!.row.id,
    });
    expect(deletedTarget.body.error?.details?.reason).toBe('DELETED');
    // A product id is not a variant.
    expect(
      (await merge({ kind: 'variant', source_id: fx.duplicate!.row.id, target_id: fx.tgt!.row.id })).status,
    ).toBe(404);
    expect((await merge({ kind: 'variant', source_id: uuidv7(), target_id: fx.tgt!.row.id })).status).toBe(
      404,
    );
    expect((await merge({ kind: 'tag', source_id: fx.src!.row.id, target_id: fx.tgt!.row.id })).status).toBe(
      400,
    );
    expect((await merge({ kind: 'variant', source_id: 'x', target_id: fx.tgt!.row.id })).status).toBe(400);
    expect(await version()).toBe(before);
  });

  it('only an admin can merge', async () => {
    const res = await merge(
      { kind: 'variant', source_id: fx.src!.row.id, target_id: fx.tgt!.row.id },
      'member',
    );
    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe('FORBIDDEN');
  });
});

describe('merge coverage', () => {
  async function tablesReferencing(parent: string): Promise<string[]> {
    const { results } = await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'
         AND name != 'd1_migrations'`,
    ).all<{ name: string }>();
    const found: string[] = [];
    for (const { name } of results) {
      const fks = await env.DB.prepare('SELECT "table" AS parent FROM pragma_foreign_key_list(?1)')
        .bind(name)
        .all<{ parent: string }>();
      if (fks.results.some((f) => f.parent === parent)) found.push(name);
    }
    return found.sort();
  }

  it('a variant merge moves every table with a foreign key to variants', async () => {
    expect(await tablesReferencing('variants')).toEqual([...VARIANT_REFERENCES].sort());
  });

  it('a product merge handles every table with a foreign key to products', async () => {
    expect(await tablesReferencing('products')).toEqual(['product_tags', 'variants']);
  });
});
