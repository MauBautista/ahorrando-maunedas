import { env } from 'cloudflare:workers';
import type { ImageRef } from '@maunedas/shared/api/catalog';
import type { EditSourceResponse } from '@maunedas/shared/api/images';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { image, product, rendition, syncHarness, type Mutation } from './support/sync';

let h: Awaited<ReturnType<typeof syncHarness>>;

beforeAll(async () => {
  h = await syncHarness();
});

beforeEach(async () => {
  await h.reset();
});

async function get(path: string, as: 'member' | null = 'member') {
  return h.app.request(
    path,
    { headers: { 'X-Client-Schema': '1', ...(as ? { Authorization: `Bearer ${h.tokens[as]}` } : {}) } },
    env as never,
  );
}
const source = async (imageId: string) =>
  (await (await get(`/v1/images/${imageId}/edit`)).json()) as EditSourceResponse;
/** The signed URL as the path the Worker serves, to fetch it without a token. */
const local = (url: string) => url.replace(env.PUBLIC_BASE_URL, '');

/** A product photo with its original in R2 and the given renditions, as `[kind, tier, created_at]`. */
async function photo(renditions: Array<[string, string, number]> = [], o: Record<string, unknown> = {}) {
  const p = product();
  const img = image(p.row.id as string, o);
  img.row.original_key = `images/${img.row.id}/original.jpg`;
  p.row.primary_image_id = img.row.id;
  const rows = renditions.map(([kind, , at]) => {
    const r = rendition(img.row.id as string, {
      kind,
      width: kind === 'thumb' ? 256 : 800,
      height: kind === 'thumb' ? 256 : 600,
      created_at: at,
      updated_at: at,
    });
    r.row.r2_key = `images/${img.row.id}/${r.row.id}.${kind === 'mask' ? 'png' : 'webp'}`;
    return r;
  });
  expect((await h.push([p, img, ...rows] as Mutation[], 'member')).status).toBe(200);
  // Clients push only their own tiers; the others are set as the Worker writes them.
  for (const [i, [, tier]] of renditions.entries()) {
    await env.DB.prepare('UPDATE image_renditions SET tier = ?1 WHERE id = ?2')
      .bind(tier, rows[i]!.row.id)
      .run();
  }
  await env.IMAGES.put(img.row.original_key as string, new Uint8Array([0xff, 0xd8, 0xff, 1]), {
    httpMetadata: { contentType: 'image/jpeg' },
  });
  return {
    product: p.row.id as string,
    image: img.row.id as string,
    ids: rows.map((r) => r.row.id as string),
  };
}

describe('GET /v1/images/:imageId/edit (10 §6.2, T-301)', () => {
  it('gives the original, the newest automatic mask and the automatic result to go back to', async () => {
    const { image: id, ids } = await photo([
      ['mask', 'device', 10],
      ['processed', 'device', 10],
      ['thumb', 'device', 10],
      ['mask', 'home', 20],
      ['processed', 'home', 20],
      ['thumb', 'home', 20],
      // Neither a hand edit nor the AI's is automatic.
      ['mask', 'manual', 30],
      ['processed', 'ai', 40],
    ]);
    const s = await source(id);
    expect(s).toMatchObject({
      image_id: id,
      edit_params: null,
      mask: { width: 800, height: 600 },
      automatic: { processed_id: ids[4], thumb_id: ids[5] },
    });
    expect(s.mask!.url).toContain(`/v1/images/${id}/blobs/${ids[3]}.png?exp=`);
    // The URLs are signed: no token needed.
    const original = await get(local(s.original_url), null);
    expect(original.status).toBe(200);
    expect(original.headers.get('Content-Type')).toBe('image/jpeg');
  });

  it('a photo edited by hand starts from its own newest mask', async () => {
    const { image: id, ids } = await photo(
      [
        ['mask', 'manual', 5],
        ['mask', 'home', 10],
        ['processed', 'home', 10],
        ['thumb', 'home', 10],
        ['mask', 'manual', 8],
      ],
      { edit_params: JSON.stringify({ rotation: 90, manual: true }) },
    );
    const s = await source(id);
    expect(s.edit_params).toBe('{"rotation":90,"manual":true}');
    expect(s.mask!.url).toContain(`${ids[4]}.png`);
    expect(s.automatic).toEqual({ processed_id: ids[2], thumb_id: ids[3] });
    // Edited by hand but never brushed: the automatic mask.
    const { image: other, ids: auto } = await photo([['mask', 'device', 3]], {
      edit_params: JSON.stringify({ manual: true }),
    });
    expect((await source(other)).mask!.url).toContain(`${auto[0]}.png`);
  });

  it('without renditions there is no mask nor anything to go back to', async () => {
    const { image: id } = await photo([['processed', 'home', 10]]);
    expect(await source(id)).toMatchObject({ mask: null, automatic: null });
  });

  it('only for a live product photo whose original is up', async () => {
    const { image: id } = await photo();
    const p = product();
    const receipt = image(p.row.id as string, { role: 'receipt' });
    const waiting = image(p.row.id as string);
    for (const m of [receipt, waiting]) m.row.original_key = `images/${m.row.id}/original.jpg`;
    expect((await h.push([p, receipt, waiting] as Mutation[], 'member')).status).toBe(200);
    await env.IMAGES.put(receipt.row.original_key as string, new Uint8Array([1]));
    const code = async (imageId: string) => {
      const res = await get(`/v1/images/${imageId}/edit`);
      return [res.status, ((await res.json()) as { error?: { code: string } }).error?.code];
    };
    expect(await code(receipt.row.id as string)).toEqual([404, 'NOT_FOUND']);
    expect(await code(waiting.row.id as string)).toEqual([409, 'IMAGE_NOT_UPLOADED']);
    expect(await code(crypto.randomUUID())).toEqual([404, 'NOT_FOUND']);
    expect(await code('no-es-uuid')).toEqual([400, 'VALIDATION_ERROR']);
    expect((await get(`/v1/images/${id}/edit`, null)).status).toBe(401);
    await env.DB.prepare('UPDATE images SET deleted_at = 1 WHERE id = ?1').bind(id).run();
    expect(await code(id)).toEqual([404, 'NOT_FOUND']);
  });
});

describe('the image reference carries the background (10 §1)', () => {
  it("is the edit's color, or white", async () => {
    const ref = async (productId: string) =>
      ((await (await get(`/v1/products/${productId}`)).json()) as { product: { image: ImageRef } }).product
        .image;
    const plain = await photo();
    expect((await ref(plain.product)).background).toBe('#FFFFFF');
    const colored = await photo([], {
      edit_params: JSON.stringify({ background: { type: 'color', value: '#fafafa' }, manual: true }),
    });
    expect((await ref(colored.product)).background).toBe('#FAFAFA');
    const broken = await photo([], {
      edit_params: JSON.stringify({ background: { type: 'color', value: 'red' } }),
    });
    expect((await ref(broken.product)).background).toBe('#FFFFFF');
  });
});
