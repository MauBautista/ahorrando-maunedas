import { env } from 'cloudflare:workers';
import { productTagId, uuidv7 } from '@maunedas/shared/util/uuid';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { verifySigned } from '../src/images/signing';
import {
  barcode,
  image,
  item,
  observation,
  product,
  purchase,
  rendition,
  store,
  syncHarness,
  t,
  variant,
  type Mutation,
} from './support/sync';

let h: Awaited<ReturnType<typeof syncHarness>>;
const DAY = 86_400_000;

beforeAll(async () => {
  h = await syncHarness();
});

async function push(mutations: Mutation[], as: 'admin' | 'member' = 'member') {
  const res = await h.push(mutations, as);
  const body = await res.json<{ conflicts: unknown[] }>();
  expect(body.conflicts).toEqual([]);
}

async function get<T>(path: string): Promise<{ status: number; body: T }> {
  const res = await h.app.request(
    path,
    { headers: { Authorization: `Bearer ${h.tokens.member}` } },
    env as never,
  );
  return { status: res.status, body: await res.json<T>() };
}

const cat = (o: Record<string, unknown>): Mutation => {
  const now = t();
  return { table: 'categories', row: { id: uuidv7(), created_at: now, updated_at: now, name: 'Cat', ...o } };
};

let fx: Record<string, Mutation>;

beforeEach(async () => {
  await h.reset();
  const now = Date.now();
  const refrigerados = cat({ name: 'Refrigerados' });
  const lacteos = cat({ name: 'Lácteos', parent_id: refrigerados.row.id });
  const costco = store({ name: 'Costco', kind: 'both' });
  const walmart = store({ name: 'Walmart', kind: 'both' });
  const leche = product({
    name: 'Leche Lala Entera',
    brand: 'Lala',
    category_id: lacteos.row.id,
    display_unit: 'L',
  });
  const l1 = variant(leche.row.id, { label: '1 L' });
  const l6 = variant(leche.row.id, { label: '6 × 1 L', pack_count: 6 });
  const cafe = product({ name: 'Café Legal', brand: 'Legal', display_unit: 'kg' });
  const kilo = variant(cafe.row.id, { label: '1 kg', measure: 'mass', unit_amount: 1000 });
  const sobres = variant(cafe.row.id, { label: '10 sobres', measure: 'count', unit_amount: 10 });
  const coca = product({ name: 'Coca-Cola 600ml', brand: 'Coca-Cola', display_unit: 'L' });
  const coca600 = variant(coca.row.id, { label: '600 ml', unit_amount: 600 });
  const borrado = product({ name: 'Leche Vieja' });
  const tag = { table: 'tags', row: { id: uuidv7(), created_at: t(), updated_at: t(), name: 'Básicos' } };
  const pt = {
    table: 'product_tags',
    row: {
      id: productTagId(leche.row.id, tag.row.id),
      created_at: t(),
      updated_at: t(),
      product_id: leche.row.id,
      tag_id: tag.row.id,
    },
  };
  const base = image(leche.row.id);
  const thumb = rendition(base.row.id);
  const img: Mutation = {
    ...base,
    row: { ...base.row, original_key: `images/${base.row.id}/original.jpg`, selected_thumb_id: thumb.row.id },
  };
  await push([
    refrigerados,
    lacteos,
    costco,
    walmart,
    leche,
    l1,
    l6,
    cafe,
    kilo,
    sobres,
    coca,
    coca600,
    borrado,
    tag,
    pt,
  ]);
  await push([
    barcode(l1.row.id, '7501020515343'),
    barcode(l6.row.id, '7501020515350'),
    img,
    thumb,
    { ...leche, row: { ...leche.row, updated_at: t(), primary_image_id: img.row.id } },
  ]);
  await push([{ ...borrado, row: { ...borrado.row, updated_at: t(), deleted_at: t() } }], 'admin');

  // Prices: 6 × 1 L at Costco $159.00 (2.65 ¢/ml) beats 1 L at Walmart $28.50 (2.85 ¢/ml).
  const p1 = purchase(costco.row.id, { purchased_at: now - DAY, status: 'confirmed' });
  const p2 = purchase(walmart.row.id, { purchased_at: now - 2 * DAY, status: 'confirmed' });
  const old = purchase(walmart.row.id, { purchased_at: now - 100 * DAY, status: 'confirmed' });
  const p3 = purchase(costco.row.id, { purchased_at: now - DAY, status: 'confirmed' });
  await push([
    p1,
    p2,
    old,
    p3,
    item(p1.row.id, l6.row.id, { unit_price_cents: 15900, gross_cents: 15900, final_cents: 15900 }),
    item(p2.row.id, l1.row.id, { unit_price_cents: 2850, gross_cents: 2850, final_cents: 2850 }),
    // Cheaper but 100 days old: outside the 90-day window of "best price".
    item(old.row.id, l1.row.id, { unit_price_cents: 1000, gross_cents: 1000, final_cents: 1000 }),
    // The only Walmart point of the 6-pack is 100 days old and very cheap: the 90-day window must drop it.
    item(old.row.id, l6.row.id, { line_no: 2, unit_price_cents: 5000, gross_cents: 5000, final_cents: 5000 }),
    item(p3.row.id, kilo.row.id, { unit_price_cents: 30000, gross_cents: 30000, final_cents: 30000 }),
    // Very cheap per piece, but "pz" does not fit the product's kg: never the best (03 §3).
    item(p3.row.id, sobres.row.id, { line_no: 2, unit_price_cents: 100, gross_cents: 100, final_cents: 100 }),
    observation(l1.row.id, walmart.row.id, { price_cents: 2700, observed_at: now - DAY / 2 }),
  ]);
  fx = {
    refrigerados,
    lacteos,
    costco,
    walmart,
    leche,
    l1,
    l6,
    cafe,
    kilo,
    sobres,
    coca,
    borrado,
    tag,
    img,
    thumb,
  };
});

interface ListBody {
  items: Array<{
    id: string;
    name: string;
    variants: number;
    best: Record<string, unknown> | null;
    image: Record<string, string | null> | null;
  }>;
  next_cursor: string | null;
}

describe('GET /v1/lookups', () => {
  it('returns live stores, branches, categories and tags', async () => {
    const { status, body } = await get<Record<string, Array<{ name: string }>>>('/v1/lookups');
    expect(status).toBe(200);
    expect(body.stores?.map((s) => s.name)).toEqual(['Costco', 'Walmart']);
    expect(body.categories?.map((c) => c.name)).toEqual(['Lácteos', 'Refrigerados']);
    expect(body.tags?.map((x) => x.name)).toEqual(['Básicos']);
    expect(body.store_branches).toEqual([]);
  });
});

describe('GET /v1/products (03 §7)', () => {
  const names = (b: ListBody) => b.items.map((i) => i.name);

  it('searches without accents or case, partially, every word (AND)', async () => {
    expect(names((await get<ListBody>('/v1/products?q=cafe')).body)).toEqual(['Café Legal']);
    expect(names((await get<ListBody>('/v1/products?q=LEC')).body)).toEqual(['Leche Lala Entera']);
    expect(names((await get<ListBody>('/v1/products?q=leche%20lala')).body)).toEqual(['Leche Lala Entera']);
    expect(names((await get<ListBody>('/v1/products?q=leche%20legal')).body)).toEqual([]);
    expect(names((await get<ListBody>('/v1/products?q=600')).body)).toEqual(['Coca-Cola 600ml']);
  });

  it('digits also search the exact barcode', async () => {
    expect(names((await get<ListBody>('/v1/products?q=7501020515350')).body)).toEqual(['Leche Lala Entera']);
  });

  it('a category includes its subcategories', async () => {
    const parent = await get<ListBody>(`/v1/products?category_id=${fx.refrigerados!.row.id}`);
    expect(names(parent.body)).toEqual(['Leche Lala Entera']);
  });

  it('filters by tag', async () => {
    expect(names((await get<ListBody>(`/v1/products?tag_id=${fx.tag!.row.id}`)).body)).toEqual([
      'Leche Lala Entera',
    ]);
  });

  it('excludes deleted products and counts live variants', async () => {
    const { body } = await get<ListBody>('/v1/products');
    expect(names(body)).toEqual(['Café Legal', 'Coca-Cola 600ml', 'Leche Lala Entera']);
    expect(body.items.find((i) => i.name === 'Café Legal')?.variants).toBe(2);
  });

  it('pages with an opaque cursor without repeating or skipping', async () => {
    const first = await get<ListBody>('/v1/products?limit=2');
    expect(first.body.items).toHaveLength(2);
    expect(first.body.next_cursor).toEqual(expect.any(String));
    const second = await get<ListBody>(`/v1/products?limit=2&cursor=${first.body.next_cursor}`);
    expect(names(second.body)).toEqual(['Leche Lala Entera']);
    expect(second.body.next_cursor).toBeNull();
    expect((await get('/v1/products?cursor=not-a-cursor')).status).toBe(400);
  });

  it('best price per unit: newest point per variant and store in 90 days, compatible measures only', async () => {
    const { body } = await get<ListBody>('/v1/products');
    const leche = body.items.find((i) => i.name === 'Leche Lala Entera');
    expect(leche?.best).toMatchObject({
      variant_id: fx.l6!.row.id,
      variant_label: '6 × 1 L',
      display_cents: 2650,
      display_unit: 'L',
      store_id: fx.costco!.row.id,
      source: 'purchase',
    });
    const cafe = body.items.find((i) => i.name === 'Café Legal');
    expect(cafe?.best).toMatchObject({
      variant_id: fx.kilo!.row.id,
      display_cents: 30000,
      display_unit: 'kg',
    });
    expect(body.items.find((i) => i.name === 'Coca-Cola 600ml')?.best).toBeNull();
  });

  it('includes the product image with signed URLs', async () => {
    const { body } = await get<ListBody>('/v1/products?q=leche');
    const ref = body.items[0]?.image;
    expect(ref).toMatchObject({ image_id: fx.img!.row.id, processed_url: null });
    for (const key of ['thumb_url', 'original_url'] as const) {
      const url = new URL(ref![key]!);
      expect(url.origin).toBe(new URL(env.PUBLIC_BASE_URL).origin);
      expect(
        await verifySigned(
          'test-image-url-secret',
          url.pathname,
          url.searchParams.get('exp')!,
          url.searchParams.get('sig')!,
        ),
      ).toBe(true);
    }
    expect(new URL(ref!.original_url!).pathname).toBe(`/v1/images/${fx.img!.row.id}/blobs/original.jpg`);
  });

  it('rejects bad filters', async () => {
    expect((await get('/v1/products?category_id=x')).status).toBe(400);
    expect((await get('/v1/products?limit=101')).status).toBe(400);
  });
});

describe('GET /v1/products/:id (03 §7)', () => {
  interface Detail {
    product: { id: string; tags: Array<{ name: string }>; image: unknown };
    variants: Array<{
      id: string;
      label: string;
      barcodes: string[];
      barcode_rows: Array<{ id: string; code: string; updated_at: number }>;
      latest: Array<Record<string, unknown>>;
    }>;
  }

  it('returns the product with tags, image and variants with barcodes and latest points', async () => {
    const { status, body } = await get<Detail>(`/v1/products/${fx.leche!.row.id}`);
    expect(status).toBe(200);
    expect(body.product.tags.map((x) => x.name)).toEqual(['Básicos']);
    expect(body.product.image).not.toBeNull();
    const l1 = body.variants.find((v) => v.label === '1 L')!;
    expect(l1.barcodes).toEqual(['7501020515343']);
    // The rows behind the codes, so the web can remove one by push.
    const code = await env.DB.prepare(
      `SELECT id, updated_at FROM barcodes WHERE code = '7501020515343'`,
    ).first<{ id: string; updated_at: number }>();
    expect(l1.barcode_rows).toEqual([{ id: code!.id, code: '7501020515343', updated_at: code!.updated_at }]);
    // Newest per (store, source): Walmart shelf $27.00 and Walmart purchase $28.50 (not the 100-day-old one).
    expect(l1.latest).toEqual([
      expect.objectContaining({
        store_id: fx.walmart!.row.id,
        source: 'shelf',
        display_cents: 2700,
        display_unit: 'L',
      }),
      expect.objectContaining({
        store_id: fx.walmart!.row.id,
        source: 'purchase',
        display_cents: 2850,
        effective_unit_cents: 2850,
      }),
    ]);
  });

  it('a variant of another measure is shown in its default unit', async () => {
    const { body } = await get<Detail>(`/v1/products/${fx.cafe!.row.id}`);
    const sobres = body.variants.find((v) => v.label === '10 sobres')!;
    expect(sobres.latest[0]).toMatchObject({ display_unit: 'pz', display_cents: 10 });
  });

  it('unknown or deleted product → 404; malformed id → 400', async () => {
    expect((await get(`/v1/products/${fx.borrado!.row.id}`)).status).toBe(404);
    expect((await get(`/v1/products/${uuidv7()}`)).status).toBe(404);
    expect((await get('/v1/products/abc')).status).toBe(400);
  });
});

describe('GET /v1/search/variants (03 §7)', () => {
  type Search = { items: Array<{ variant_label: string; product_name: string; barcode_match: boolean }> };

  it('finds variants by product, brand and label words', async () => {
    const { body } = await get<Search>('/v1/search/variants?q=lala%206');
    expect(body.items.map((i) => i.variant_label)).toEqual(['6 × 1 L']);
    const all = await get<Search>('/v1/search/variants?q=leche');
    expect(all.body.items.map((i) => i.variant_label)).toEqual(['1 L', '6 × 1 L']);
  });

  it('a barcode match comes first and is flagged', async () => {
    const { body } = await get<Search>('/v1/search/variants?q=7501020515350');
    expect(body.items[0]).toMatchObject({ variant_label: '6 × 1 L', barcode_match: true });
  });

  it('requires q', async () => {
    expect((await get('/v1/search/variants')).status).toBe(400);
  });
});
