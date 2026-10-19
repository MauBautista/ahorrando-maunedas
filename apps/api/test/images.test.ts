import { env } from 'cloudflare:workers';
import { MAX_IMPORT_BYTES, MAX_UPLOAD_BYTES } from '@maunedas/shared/api/images';
import { uuidv7 } from '@maunedas/shared/util/uuid';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
import { imageRefs } from '../src/images/refs';
import { signPath } from '../src/images/signing';
import { edit, image, product, rendition, syncHarness, t, type Mutation } from './support/sync';

/** Fake catalog image hosts: path → response factory. */
let routes: Record<string, () => Response>;
let calls: Array<{ url: string; userAgent: string | null; redirect: RequestInit['redirect'] }>;
const fakeFetch: typeof fetch = async (input, init) => {
  const url = String(input instanceof Request ? input.url : input);
  calls.push({ url, userAgent: new Headers(init?.headers).get('User-Agent'), redirect: init?.redirect });
  const route = routes[url];
  if (!route) return new Response('not found', { status: 404 });
  return route();
};

let h: Awaited<ReturnType<typeof syncHarness>>;
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 0xff, 0xd9]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 9, 8, 7, 6]);
/** The test-only secret of vitest.config.ts. */
const IMAGE_URL_SECRET = 'test-image-url-secret';

beforeAll(async () => {
  h = await syncHarness({ fetch: fakeFetch });
});

let photo: Mutation;
let thumb: Mutation;

beforeEach(async () => {
  await h.reset();
  routes = {};
  calls = [];
  const leche = product();
  const base = image(leche.row.id);
  thumb = rendition(base.row.id);
  photo = { ...base, row: { ...base.row, original_key: `images/${base.row.id}/original.jpg` } };
  const res = await h.push([leche, photo, thumb]);
  expect((await res.json<{ conflicts: unknown[] }>()).conflicts).toEqual([]);
});

const auth = () => ({ Authorization: `Bearer ${h.tokens.member}` });

function put(
  imageId: string,
  name: string,
  bytes: Uint8Array,
  type = 'image/jpeg',
  headers: Record<string, string> = {},
) {
  return h.app.request(
    `/v1/images/${imageId}/blobs/${name}`,
    {
      method: 'PUT',
      headers: { ...auth(), 'Content-Type': type, 'Content-Length': String(bytes.byteLength), ...headers },
      body: bytes,
    },
    env as never,
  );
}

const getBlob = (path: string, headers: Record<string, string> = auth()) =>
  h.app.request(path, { headers }, env as never);

const errorCode = async (res: Response) =>
  (await res.json<{ error: { code: string; details?: { reason?: string } } }>()).error;

describe('PUT /v1/images/:imageId/blobs/:name (10 §4.1)', () => {
  it('stores the original of a synced image and answers its key and size', async () => {
    const res = await put(photo.row.id, 'original.jpg', JPEG);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ key: `images/${photo.row.id}/original.jpg`, bytes: JPEG.byteLength });
    const object = await env.IMAGES.get(`images/${photo.row.id}/original.jpg`);
    expect(new Uint8Array(await object!.arrayBuffer())).toEqual(JPEG);
    expect(object!.httpMetadata?.contentType).toBe('image/jpeg');
  });

  it('stores a device or manual rendition at its r2_key', async () => {
    const res = await put(photo.row.id, `${thumb.row.id}.webp`, WEBP, 'image/webp');
    expect(res.status).toBe(201);
    expect(await env.IMAGES.head(`images/${photo.row.id}/${thumb.row.id}.webp`)).not.toBeNull();
  });

  it('a second upload of the same key keeps the first bytes and answers the same', async () => {
    await put(photo.row.id, 'original.jpg', JPEG);
    const again = await put(photo.row.id, 'original.jpg', new Uint8Array([1, 2, 3]));
    expect(again.status).toBe(201);
    expect(await again.json()).toMatchObject({ bytes: JPEG.byteLength });
    const object = await env.IMAGES.get(`images/${photo.row.id}/original.jpg`);
    expect(new Uint8Array(await object!.arrayBuffer())).toEqual(JPEG);
  });

  it('rejects an invalid name, a wrong type and more than 15 MB', async () => {
    for (const name of ['photo.jpg', 'original.gif', 'original.jpg.exe', `${thumb.row.id}.jpg`]) {
      const res = await put(photo.row.id, name, JPEG);
      expect(res.status, name).toBe(400);
    }
    expect((await put(photo.row.id, 'original.jpg', JPEG, 'image/png')).status).toBe(415);
    expect((await put(photo.row.id, 'original.jpg', JPEG, 'text/plain')).status).toBe(415);
    const big = await put(photo.row.id, 'original.jpg', new Uint8Array(MAX_UPLOAD_BYTES + 1));
    expect(big.status).toBe(413);
    expect((await errorCode(big)).code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('409 IMAGE_NOT_FOUND when the row is missing, deleted or points at another key', async () => {
    const missing = await put(uuidv7(), 'original.jpg', JPEG);
    expect(missing.status).toBe(409);
    expect((await errorCode(missing)).code).toBe('IMAGE_NOT_FOUND');
    expect((await put(photo.row.id, 'original.png', JPEG, 'image/png')).status).toBe(409);
    expect((await put(photo.row.id, `${uuidv7()}.webp`, WEBP, 'image/webp')).status).toBe(409);
    await h.push([edit(photo, { deleted_at: t() })], 'admin');
    expect((await put(photo.row.id, 'original.jpg', JPEG)).status).toBe(409);
  });

  it('a home rendition (written by the agent) cannot be uploaded by a client', async () => {
    const id = uuidv7();
    await env.DB.prepare(
      `INSERT INTO image_renditions (id, image_id, kind, tier, r2_key, created_at, updated_at)
       VALUES (?1, ?2, 'processed', 'home', ?3, 1, 1)`,
    )
      .bind(id, photo.row.id, `images/${photo.row.id}/${id}.webp`)
      .run();
    expect((await put(photo.row.id, `${id}.webp`, WEBP, 'image/webp')).status).toBe(409);
  });

  it('requires a session', async () => {
    expect((await put(photo.row.id, 'original.jpg', JPEG, 'image/jpeg', { Authorization: '' })).status).toBe(
      401,
    );
  });
});

describe('GET /v1/images/:imageId/blobs/:name (10 §3, §4.1)', () => {
  const path = () => `/v1/images/${photo.row.id}/blobs/original.jpg`;

  beforeEach(async () => {
    await put(photo.row.id, 'original.jpg', JPEG);
  });

  it('with a session: the bytes, immutable caching and an ETag; If-None-Match → 304', async () => {
    const res = await getBlob(path());
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(JPEG);
    expect(res.headers.get('Content-Type')).toBe('image/jpeg');
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=31536000, immutable');
    const etag = res.headers.get('ETag')!;
    expect(etag).toMatch(/^"/);
    const cached = await getBlob(path(), { ...auth(), 'If-None-Match': etag });
    expect(cached.status).toBe(304);
  });

  it('with the signed URL of an ImageRef, without a session', async () => {
    const refs = await imageRefs(env as unknown as Env, [photo.row.id]);
    const url = new URL(refs.get(photo.row.id)!.original_url!);
    const res = await getBlob(url.pathname + url.search, {});
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(JPEG);
  });

  it('a tampered, expired or foreign signature → 401 INVALID_SIGNATURE', async () => {
    const signed = new URL(await signPath(IMAGE_URL_SECRET, path(), 24 * 3_600_000), 'https://x');
    const sig = signed.searchParams.get('sig')!;
    const exp = signed.searchParams.get('exp')!;
    const flipped = `${sig.slice(0, -1)}${sig.endsWith('0') ? '1' : '0'}`;
    const cases = [
      `${path()}?exp=${exp}&sig=${flipped}`,
      `${path()}?exp=${Number(exp) + 1}&sig=${sig}`,
      `/v1/images/${photo.row.id}/blobs/${thumb.row.id}.webp?exp=${exp}&sig=${sig}`,
      `${path()}?exp=${exp}`,
    ];
    for (const target of cases) {
      const res = await getBlob(target, {});
      expect(res.status, target).toBe(401);
      expect((await errorCode(res)).code).toBe('INVALID_SIGNATURE');
    }
    const old = new URL(
      await signPath(IMAGE_URL_SECRET, path(), 10 * 60_000, Date.now() - 11 * 60_000),
      'https://x',
    );
    expect((await getBlob(path() + old.search, {})).status).toBe(401);
  });

  it('without a session or signature → 401; a blob not uploaded → 404', async () => {
    const res = await getBlob(path(), {});
    expect(res.status).toBe(401);
    expect((await errorCode(res)).code).toBe('UNAUTHENTICATED');
    expect((await getBlob(`/v1/images/${photo.row.id}/blobs/${thumb.row.id}.webp`)).status).toBe(404);
  });
});

describe('POST /v1/images/:imageId/import (10 §2.3)', () => {
  const SOURCE = 'https://images.openfoodfacts.org/images/products/750/105/530/0075/front_es.400.jpg';
  const importImage = (imageId: string, source_url: string) =>
    h.app.request(
      `/v1/images/${imageId}/import`,
      {
        method: 'POST',
        headers: { ...auth(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_url }),
      },
      env as never,
    );

  it('downloads from an allowed host and stores it as the original', async () => {
    routes[SOURCE] = () => new Response(JPEG, { headers: { 'Content-Type': 'image/jpeg' } });
    const res = await importImage(photo.row.id, SOURCE);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ key: `images/${photo.row.id}/original.jpg`, bytes: JPEG.byteLength });
    const object = await env.IMAGES.get(`images/${photo.row.id}/original.jpg`);
    expect(new Uint8Array(await object!.arrayBuffer())).toEqual(JPEG);
    expect(calls).toEqual([{ url: SOURCE, userAgent: env.OFF_USER_AGENT, redirect: 'manual' }]);

    // Already imported: answers the same without downloading again.
    expect((await importImage(photo.row.id, SOURCE)).status).toBe(201);
    expect(calls).toHaveLength(1);
  });

  it('rejects hosts outside the list (HOST_NOT_ALLOWED), also through redirects', async () => {
    for (const bad of [
      'https://evil.example/x.jpg',
      'http://images.openfoodfacts.org/x.jpg',
      'https://images.openfoodfacts.org@evil.example/x.jpg',
      'https://user:secret@images.openfoodfacts.org/x.jpg',
      'https://user@images.openfoodfacts.org/x.jpg',
      'https://images.openfoodfacts.org:8443/x.jpg',
      'https://images.openfoodfacts.org.evil.example/x.jpg',
      'not a url',
    ]) {
      const res = await importImage(photo.row.id, bad);
      expect(res.status, bad).toBe(400);
      expect((await errorCode(res)).details?.reason, bad).toBe('HOST_NOT_ALLOWED');
    }
    routes[SOURCE] = () =>
      new Response(null, { status: 302, headers: { Location: 'https://evil.example/x.jpg' } });
    const res = await importImage(photo.row.id, SOURCE);
    expect((await errorCode(res)).details?.reason).toBe('HOST_NOT_ALLOWED');
    expect(calls.map((c) => c.url)).toEqual([SOURCE]);
  });

  it('follows a redirect to another allowed host', async () => {
    const target = 'https://static.openfoodfacts.org/images/x.jpg';
    routes[SOURCE] = () => new Response(null, { status: 301, headers: { Location: target } });
    routes[target] = () => new Response(JPEG, { headers: { 'Content-Type': 'image/jpeg' } });
    expect((await importImage(photo.row.id, SOURCE)).status).toBe(201);
    expect(calls.map((c) => c.url)).toEqual([SOURCE, target]);
  });

  it('only images of at most 10 MB; upstream failures → 502', async () => {
    routes[SOURCE] = () => new Response('<html>', { headers: { 'Content-Type': 'text/html' } });
    expect((await importImage(photo.row.id, SOURCE)).status).toBe(415);
    // No Content-Length: the limit is counted while reading.
    routes[SOURCE] = () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(MAX_IMPORT_BYTES));
            controller.enqueue(new Uint8Array(1));
            controller.close();
          },
        }),
        { headers: { 'Content-Type': 'image/jpeg' } },
      );
    expect((await importImage(photo.row.id, SOURCE)).status).toBe(413);
    routes[SOURCE] = () => new Response('down', { status: 503 });
    const res = await importImage(photo.row.id, SOURCE);
    expect(res.status).toBe(502);
    expect((await errorCode(res)).code).toBe('UPSTREAM_ERROR');
    expect(await env.IMAGES.head(`images/${photo.row.id}/original.jpg`)).toBeNull();
  });

  it('the image row must exist with an original key', async () => {
    routes[SOURCE] = () => new Response(JPEG, { headers: { 'Content-Type': 'image/jpeg' } });
    expect((await importImage(uuidv7(), SOURCE)).status).toBe(409);
    const bare = image(photo.row.owner_id as string);
    await h.push([bare]);
    expect((await importImage(bare.row.id, SOURCE)).status).toBe(409);
    expect(calls).toEqual([]);
  });
});
