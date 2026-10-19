import { env } from 'cloudflare:workers';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FOUND_TTL_MS, NOT_FOUND_TTL_MS } from '../src/catalog/off';
import { barcode, edit, product, syncHarness, t, variant, type Mutation } from './support/sync';

/** What each fake catalog answers: a product, 404, an HTTP error or a network failure. */
type Reply = Record<string, unknown> | 404 | 500 | 'network' | 'status0';
const OFF = 'world.openfoodfacts.org';
const OBF = 'world.openbeautyfacts.org';
const OPF = 'world.openproductsfacts.org';

let replies: Record<string, Reply>;
let calls: Array<{ host: string; url: URL; userAgent: string | null }>;

const fakeFetch: typeof fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  calls.push({ host: url.host, url, userAgent: new Headers(init?.headers).get('User-Agent') });
  const reply = replies[url.host] ?? 404;
  if (reply === 'network') throw new TypeError('Network connection lost.');
  if (reply === 404)
    return Response.json({ status: 0, status_verbose: 'product not found' }, { status: 404 });
  if (reply === 500) return new Response('upstream down', { status: 500 });
  if (reply === 'status0') return Response.json({ status: 0 });
  return Response.json({ code: url.pathname.split('/').at(-1), status: 1, product: reply });
};

let h: Awaited<ReturnType<typeof syncHarness>>;

beforeAll(async () => {
  h = await syncHarness({ fetch: fakeFetch });
});

beforeEach(async () => {
  await h.reset();
  await env.DB.prepare('DELETE FROM off_cache').run();
  replies = {};
  calls = [];
});

interface Lookup {
  code: string;
  match: Record<string, string> | null;
  catalog: Record<string, unknown> | null;
}

async function lookup(
  code: string,
): Promise<{ status: number; body: Lookup & { error?: { code: string; details?: unknown } } }> {
  const res = await h.app.request(
    `/v1/barcodes/${encodeURIComponent(code)}`,
    { headers: { Authorization: `Bearer ${h.tokens.member}` } },
    env as never,
  );
  return { status: res.status, body: await res.json() };
}

const LECHE = {
  product_name: 'Lala Whole Milk',
  product_name_es: 'Leche Lala Entera',
  brands: 'Lala, Grupo Lala',
  quantity: '6 x 1 l',
  image_front_url: 'https://images.openfoodfacts.org/images/products/750/102/051/5350/front_es.jpg',
  image_url: 'https://images.openfoodfacts.org/images/products/750/102/051/5350/front.jpg',
};
const CODE = '7501020515350';

describe('GET /v1/barcodes/:code (03 §8, 10 §2.1)', () => {
  it('rejects codes that are not 6–14 digits', async () => {
    for (const bad of ['abc123', '12345', '123456789012345', '7501020515350x']) {
      const { status, body } = await lookup(bad);
      expect(status, bad).toBe(400);
      expect(body.error?.code).toBe('INVALID_BARCODE');
    }
    expect(calls).toEqual([]);
  });

  it('spaces and hyphens are formatting', async () => {
    const { status, body } = await lookup('750-1020 515350');
    expect(status).toBe(200);
    expect(body.code).toBe(CODE);
  });

  it('a live barcode of ours is a match and the open catalogs are not asked', async () => {
    const leche = product({ name: 'Leche Lala Entera' });
    const l6 = variant(leche.row.id, { label: '6 × 1 L', pack_count: 6 });
    await h.push([leche, l6, barcode(l6.row.id, CODE)]);
    const { status, body } = await lookup(CODE);
    expect(status).toBe(200);
    expect(body).toEqual({
      code: CODE,
      match: {
        variant_id: l6.row.id,
        product_id: leche.row.id,
        product_name: 'Leche Lala Entera',
        variant_label: '6 × 1 L',
      },
      catalog: null,
    });
    expect(calls).toEqual([]);
  });

  it('a deleted barcode is not a match', async () => {
    const leche = product();
    const l1 = variant(leche.row.id);
    const code: Mutation = barcode(l1.row.id, CODE);
    await h.push([leche, l1, code]);
    await h.push([edit(code, { deleted_at: t() })]);
    replies[OFF] = LECHE;
    const { body } = await lookup(CODE);
    expect(body.match).toBeNull();
    expect(body.catalog).toMatchObject({ source: 'off' });
  });

  it('maps an Open Food Facts product, sends the User-Agent and caches the hit', async () => {
    replies[OFF] = LECHE;
    const { status, body } = await lookup(CODE);
    expect(status).toBe(200);
    expect(body.catalog).toEqual({
      source: 'off',
      name: 'Leche Lala Entera',
      brand: 'Lala',
      quantity_text: '6 x 1 l',
      parsed: { measure: 'volume', unit_amount: 1000, pack_count: 6 },
      image_url: LECHE.image_front_url,
      license: 'CC BY-SA 3.0',
      attribution: 'Open Food Facts contributors',
      source_url: `https://${OFF}/product/${CODE}`,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url.pathname).toBe(`/api/v2/product/${CODE}.json`);
    expect(calls[0]!.url.searchParams.get('fields')).toBe(
      'product_name,product_name_es,brands,quantity,image_front_url,image_url',
    );
    expect(calls[0]!.userAgent).toBe(env.OFF_USER_AGENT);

    const again = await lookup(CODE);
    expect(again.body.catalog).toEqual(body.catalog);
    expect(calls).toHaveLength(1);
  });

  it('falls back to product_name, image_url and null fields', async () => {
    replies[OFF] = {
      product_name: 'Galletas',
      image_front_url: 'http://insecure.example/x.jpg',
      image_url: LECHE.image_url,
    };
    const { body } = await lookup(CODE);
    expect(body.catalog).toMatchObject({
      name: 'Galletas',
      brand: null,
      quantity_text: null,
      parsed: null,
      image_url: LECHE.image_url,
    });
  });

  it('asks Open Food Facts → Open Beauty Facts → Open Products Facts, stopping at the first hit', async () => {
    replies[OBF] = { product_name: 'Shampoo', quantity: '400 ml' };
    replies[OPF] = { product_name: 'Nunca' };
    const { body } = await lookup(CODE);
    expect(calls.map((c) => c.host)).toEqual([OFF, OBF]);
    expect(body.catalog).toMatchObject({
      source: 'obf',
      name: 'Shampoo',
      attribution: 'Open Beauty Facts contributors',
      source_url: `https://${OBF}/product/${CODE}`,
      parsed: { measure: 'volume', unit_amount: 400, pack_count: 1 },
    });
  });

  it('caches a miss for 7 days; then asks again', async () => {
    expect([FOUND_TTL_MS, NOT_FOUND_TTL_MS]).toEqual([30 * 86_400_000, 7 * 86_400_000]);
    replies[OFF] = 'status0';
    const { body } = await lookup(CODE);
    expect(body).toEqual({ code: CODE, match: null, catalog: null });
    expect(calls.map((c) => c.host)).toEqual([OFF, OBF, OPF]);
    await lookup(CODE);
    expect(calls).toHaveLength(3);

    await env.DB.prepare('UPDATE off_cache SET fetched_at = fetched_at - ?1').bind(NOT_FOUND_TTL_MS).run();
    replies[OFF] = LECHE;
    expect((await lookup(CODE)).body.catalog).toMatchObject({ source: 'off', name: 'Leche Lala Entera' });
    expect(calls).toHaveLength(4);
  });

  it('a hit lasts 30 days; then it is refreshed', async () => {
    replies[OFF] = LECHE;
    await lookup(CODE);
    await env.DB.prepare('UPDATE off_cache SET fetched_at = fetched_at - ?1')
      .bind(FOUND_TTL_MS - 60_000)
      .run();
    await lookup(CODE);
    expect(calls).toHaveLength(1);
    await env.DB.prepare('UPDATE off_cache SET fetched_at = fetched_at - ?1').bind(120_000).run();
    replies[OFF] = { ...LECHE, product_name_es: 'Leche Lala Entera 6 pack' };
    expect((await lookup(CODE)).body.catalog).toMatchObject({ name: 'Leche Lala Entera 6 pack' });
    expect(calls).toHaveLength(2);
  });

  it('when a catalog fails and none has the code: 502 and nothing is cached', async () => {
    replies[OFF] = 500;
    const { status, body } = await lookup(CODE);
    expect(status).toBe(502);
    expect(body.error).toMatchObject({ code: 'UPSTREAM_ERROR', details: { service: 'open_catalog' } });
    expect(await env.DB.prepare('SELECT count(*) AS n FROM off_cache').first('n')).toBe(0);

    replies[OFF] = 'network';
    expect((await lookup(CODE)).status).toBe(502);
  });

  it('a failure does not hide a hit in a later catalog', async () => {
    replies[OFF] = 'network';
    replies[OBF] = { product_name: 'Crema' };
    const { status, body } = await lookup(CODE);
    expect(status).toBe(200);
    expect(body.catalog).toMatchObject({ source: 'obf', name: 'Crema' });
  });

  it('serves a stale hit when the refresh fails', async () => {
    replies[OFF] = LECHE;
    await lookup(CODE);
    await env.DB.prepare('UPDATE off_cache SET fetched_at = fetched_at - ?1')
      .bind(FOUND_TTL_MS + 1)
      .run();
    replies[OFF] = 500;
    const { status, body } = await lookup(CODE);
    expect(status).toBe(200);
    expect(body.catalog).toMatchObject({ source: 'off', name: 'Leche Lala Entera' });
  });

  it('requires a session', async () => {
    const res = await h.app.request(`/v1/barcodes/${CODE}`, {}, env as never);
    expect(res.status).toBe(401);
  });
});
