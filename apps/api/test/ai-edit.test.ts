import { env } from 'cloudflare:workers';
import type { AiEditQuote, AiEditResponse } from '@maunedas/shared/api/images';
import { DEFAULT_AI_EDIT_PROMPT } from '@maunedas/shared/api/images';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OPENROUTER_URL, OpenRouterProvider } from '../src/ai/providers/openrouter';
import { InvalidAiOutput } from '../src/ai/types';
import { image, product, syncHarness, type Mutation } from './support/sync';

/** The edit model is chosen by Mauricio (T-302); the tests bring their own and a fake OpenRouter. */
const withModel = { ...env, AI_IMAGE_EDIT_MODEL: 'test/image-model' };
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const dataUrl = (bytes: Uint8Array, mime = 'image/png') =>
  `data:${mime};base64,${btoa(String.fromCharCode(...bytes))}`;

let answers: Array<Response | Error> = [];
const asked: Array<{ url: string; body: Record<string, unknown> }> = [];
const fakeFetch: typeof fetch = async (input, init) => {
  asked.push({ url: String(input), body: JSON.parse(String(init?.body)) });
  const next = answers.shift();
  if (!next) throw new Error('no more answers');
  if (next instanceof Error) throw next;
  return next;
};
/** A chat completion with an image, as OpenRouter's image output; [cost] null when it does not say. */
const imageAnswer = (url: string | null, cost: number | null = 0.039) =>
  Response.json({
    model: 'test/image-model-2026',
    choices: [
      { message: { content: 'Listo.', ...(url === null ? {} : { images: [{ image_url: { url } }] }) } },
    ],
    usage: { prompt_tokens: 1300, completion_tokens: 1290, ...(cost === null ? {} : { cost }) },
  });

let h: Awaited<ReturnType<typeof syncHarness>>;
let fx: { photo: string; receipt: string; missing: string };

beforeAll(async () => {
  h = await syncHarness({ fetch: fakeFetch });
});

beforeEach(async () => {
  await h.reset();
  answers = [];
  asked.length = 0;
  await env.DB.prepare('DELETE FROM ai_usage').run();
  const p = product();
  const photo = image(p.row.id as string);
  const receipt = image(p.row.id as string, { role: 'receipt' });
  const missing = image(p.row.id as string);
  for (const m of [photo, receipt, missing]) m.row.original_key = `images/${m.row.id}/original.jpg`;
  expect((await h.push([p, photo, receipt, missing] as Mutation[], 'member')).status).toBe(200);
  for (const m of [photo, receipt])
    await env.IMAGES.put(m.row.original_key as string, new Uint8Array([0xff, 0xd8]));
  fx = {
    photo: photo.row.id as string,
    receipt: receipt.row.id as string,
    missing: missing.row.id as string,
  };
});

async function call(
  method: string,
  path: string,
  body?: unknown,
  environment: object = withModel,
  auth = true,
) {
  const res = await h.app.request(
    path,
    {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Schema': '1',
        ...(auth ? { Authorization: `Bearer ${h.tokens.member}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    environment as never,
  );
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
const edit = (imageId: string, body: unknown = { confirm: true }, environment?: object) =>
  call('POST', `/v1/images/${imageId}/ai-edit`, body, environment);
const usage = async () =>
  (
    await env.DB.prepare(
      'SELECT purpose, model, user_id, cost_usd_micros FROM ai_usage ORDER BY created_at, id',
    ).all()
  ).results;

describe('GET /v1/ai/image-edit (10 §6.3, T-302)', () => {
  it('says what an edit would cost, the month so far, and whether it can be made', async () => {
    expect((await call('GET', '/v1/ai/image-edit', undefined, env)).body).toEqual({
      available: false,
      reason: 'NOT_CONFIGURED',
      estimate_usd: 0.04,
      spent_usd: 0,
      budget_usd: 5,
    } satisfies AiEditQuote);
    expect((await call('GET', '/v1/ai/image-edit')).body).toMatchObject({ available: true, reason: null });
    // $4.97 spent: one more $0.04 edit would pass the $5 budget; $4.96 lands on it exactly and is allowed.
    await env.DB.prepare(
      `INSERT INTO ai_usage (id, purpose, provider, model, cost_usd_micros, created_at)
       VALUES ('u1', 'receipt', 'openrouter', 'm', 4960000, ?1)`,
    )
      .bind(Date.now())
      .run();
    expect((await call('GET', '/v1/ai/image-edit')).body).toMatchObject({ available: true, spent_usd: 4.96 });
    await env.DB.prepare(`UPDATE ai_usage SET cost_usd_micros = 4970000`).run();
    expect((await call('GET', '/v1/ai/image-edit')).body).toMatchObject({
      available: false,
      reason: 'BUDGET',
    });
    expect((await call('GET', '/v1/ai/image-edit', undefined, withModel, false)).status).toBe(401);
  });
});

describe('POST /v1/images/:imageId/ai-edit (10 §6.3, T-302)', () => {
  it('sends the original by a signed URL and keeps the edit as an ai rendition, billed', async () => {
    answers = [imageAnswer(dataUrl(PNG))];
    const before = Number(
      await env.DB.prepare(`SELECT value FROM sync_meta WHERE key = 'version'`).first('value'),
    );
    const res = await edit(fx.photo);
    expect(res.status).toBe(201);
    const done = res.body as AiEditResponse;
    expect(done.cost_usd).toBe(0.039);

    const [request] = asked;
    expect(request!.url).toBe(OPENROUTER_URL);
    expect(request!.body).toMatchObject({
      model: 'test/image-model',
      modalities: ['image', 'text'],
      usage: { include: true },
    });
    const content = (
      request!.body.messages as Array<{ content: Array<{ text?: string; image_url?: { url: string } }> }>
    )[0]!.content;
    expect(content[0]!.text).toBe(DEFAULT_AI_EDIT_PROMPT);
    expect(content[1]!.image_url!.url).toMatch(
      new RegExp(`^${env.PUBLIC_BASE_URL}/v1/images/${fx.photo}/blobs/original\\.jpg\\?exp=\\d+&sig=`),
    );

    const row = await env.DB.prepare(
      'SELECT image_id, kind, tier, r2_key, width, height, bytes, version FROM image_renditions WHERE id = ?1',
    )
      .bind(done.rendition_id)
      .first();
    expect(row).toEqual({
      image_id: fx.photo,
      kind: 'processed',
      tier: 'ai',
      r2_key: `images/${fx.photo}/${done.rendition_id}.png`,
      width: null,
      height: null,
      bytes: PNG.length,
      version: before + 1,
    });
    const stored = await env.IMAGES.get(`images/${fx.photo}/${done.rendition_id}.png`);
    expect([stored!.httpMetadata?.contentType, new Uint8Array(await stored!.arrayBuffer())]).toEqual([
      'image/png',
      PNG,
    ]);
    // The URL answered is signed: the page shows it without a token.
    const shown = await h.app.request(done.url.replace(env.PUBLIC_BASE_URL, ''), {}, env as never);
    expect(shown.status).toBe(200);
    expect(await usage()).toEqual([
      {
        purpose: 'image_edit',
        model: 'test/image-model-2026',
        user_id: expect.any(String),
        cost_usd_micros: 39_000,
      },
    ]);
  });

  it('passes the household prompt, and takes WebP too', async () => {
    answers = [imageAnswer(dataUrl(PNG, 'image/webp'), null)];
    const res = await edit(fx.photo, { prompt: '  Quita el reflejo  ', confirm: true });
    expect(res.status).toBe(201);
    const content = (asked[0]!.body.messages as Array<{ content: Array<{ text?: string }> }>)[0]!.content;
    expect(content[0]!.text).toBe('Quita el reflejo');
    expect(
      await env.IMAGES.head(`images/${fx.photo}/${(res.body as AiEditResponse).rendition_id}.webp`),
    ).not.toBeNull();
    // Without a reported cost, the estimate is billed.
    expect((res.body as AiEditResponse).cost_usd).toBe(0.04);
  });

  it('an unusable image is billed and tried once more; twice is 502 and keeps nothing', async () => {
    answers = [imageAnswer(dataUrl(PNG, 'image/jpeg')), imageAnswer(null, 0.01)];
    const res = await edit(fx.photo);
    expect([res.status, res.body.error.code]).toEqual([502, 'UPSTREAM_ERROR']);
    expect((await usage()).map((u) => u.cost_usd_micros)).toEqual([39_000, 10_000]);
    expect(Number(await env.DB.prepare('SELECT count(*) AS n FROM image_renditions').first('n'))).toBe(0);
    // An empty image, then a good one.
    answers = [imageAnswer('data:image/png;base64,'), imageAnswer(dataUrl(PNG))];
    expect((await edit(fx.photo)).status).toBe(201);
    expect(await usage()).toHaveLength(4);
    // Not a data URL at all.
    answers = [imageAnswer('https://otro.sitio/imagen.png'), imageAnswer('data:text/plain;base64,aG9sYQ==')];
    expect((await edit(fx.photo)).status).toBe(502);
  });

  it('a provider that does not answer is 503 and costs nothing', async () => {
    answers = [new Response('caído', { status: 503 }), new Response('ocupado', { status: 429 })];
    const res = await edit(fx.photo);
    expect([res.status, res.body.error.code]).toEqual([503, 'AI_UNAVAILABLE']);
    expect(await usage()).toEqual([]);
  });

  it('needs a model, the budget, a product photo with its original, and the confirmation', async () => {
    expect((await edit(fx.photo, { confirm: true }, env)).body.error.code).toBe('AI_UNAVAILABLE');
    expect(asked).toHaveLength(0);
    await env.DB.prepare(
      `INSERT INTO ai_usage (id, purpose, provider, model, cost_usd_micros, created_at)
       VALUES ('u1', 'image_edit', 'openrouter', 'm', 4970000, ?1)`,
    )
      .bind(Date.now())
      .run();
    expect((await edit(fx.photo)).body.error.code).toBe('AI_BUDGET_EXCEEDED');
    await env.DB.prepare('DELETE FROM ai_usage').run();
    expect((await edit(fx.receipt)).status).toBe(404);
    expect((await edit(fx.missing)).body.error.code).toBe('IMAGE_NOT_UPLOADED');
    expect((await edit(fx.photo, {})).status).toBe(400);
    expect((await edit(fx.photo, { confirm: false })).status).toBe(400);
    expect((await edit(fx.photo, { confirm: true, prompt: '' })).status).toBe(400);
    expect((await edit('no-es-uuid')).status).toBe(400);
    expect(
      (await call('POST', `/v1/images/${fx.photo}/ai-edit`, { confirm: true }, withModel, false)).status,
    ).toBe(401);
    expect(asked).toHaveLength(0);
  });
});

describe('OpenRouter image output (09 §1, T-302)', () => {
  it('takes only an image data URL, and bills what was not one', async () => {
    const provider = new OpenRouterProvider(withModel, 'test/image-model', fakeFetch);
    for (const url of [
      'data:text/plain;base64,aG9sYQ==',
      'https://otro.sitio/a,b.png',
      'data:image/png,crudo',
    ]) {
      answers = [imageAnswer(url, 0.02)];
      const error = await provider.editImage('https://img/original.jpg', 'x').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(InvalidAiOutput);
      expect((error as InvalidAiOutput).usage?.cost_usd).toBe(0.02);
    }
    answers = [imageAnswer(dataUrl(PNG))];
    expect(await provider.editImage('https://img/original.jpg', 'x')).toMatchObject({
      mime: 'image/png',
      image: PNG,
    });
  });
});
