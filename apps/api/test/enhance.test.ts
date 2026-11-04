import { env } from 'cloudflare:workers';
import type { AgentJobClaim, AgentJobResult } from '@maunedas/shared/api/agent';
import type { EnhanceResponse } from '@maunedas/shared/api/images';
import { uuidv7 } from '@maunedas/shared/util/uuid';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { image, product, syncHarness, type Mutation } from './support/sync';

const AGENT = 'test-agent-token';

let h: Awaited<ReturnType<typeof syncHarness>>;
let fx: { photo: string; receipt: string; missing: string };

beforeAll(async () => {
  h = await syncHarness();
});

async function call(
  method: string,
  path: string,
  auth: { as?: 'admin' | 'member'; token?: string },
  body?: BodyInit,
  headers: Record<string, string> = {},
) {
  const bearer = auth.token ?? (auth.as ? h.tokens[auth.as] : undefined);
  const res = await h.app.request(
    path,
    {
      method,
      headers: {
        'X-Client-Schema': '1',
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
        ...headers,
      },
      body,
    },
    env as never,
  );
  return res;
}

const json = async (res: Response) => {
  const text = await res.text();
  return text ? JSON.parse(text) : null;
};

const enhance = (imageId: string, as: 'admin' | 'member' = 'member') =>
  call('POST', `/v1/images/${imageId}/enhance`, { as });
const claim = () => call('POST', '/agent/v1/jobs/claim', { token: AGENT });
const upload = (jobId: string, kind: string, bytes: Uint8Array, type: string, query = '') =>
  call('PUT', `/agent/v1/jobs/${jobId}/result/${kind}${query}`, { token: AGENT }, bytes, {
    'Content-Type': type,
    'Content-Length': String(bytes.length),
  });
const job = (id: string) =>
  env.DB.prepare('SELECT status, attempts, error, claimed_at FROM image_jobs WHERE id = ?1')
    .bind(id)
    .first<{ status: string; attempts: number; error: string | null; claimed_at: number | null }>();
/** Moves a claim back in time, as if its lease ran out. */
const expire = (id: string) =>
  env.DB.prepare('UPDATE image_jobs SET claimed_at = claimed_at - 600001 WHERE id = ?1').bind(id).run();

beforeEach(async () => {
  await h.reset();
  const p = product();
  const photo = image(p.row.id as string);
  const receipt = image(p.row.id as string, { role: 'receipt' });
  const missing = image(p.row.id as string);
  for (const m of [photo, receipt, missing]) m.row.original_key = `images/${m.row.id}/original.jpg`;
  expect((await h.push([p, photo, receipt, missing] as Mutation[], 'member')).status).toBe(200);
  for (const m of [photo, receipt]) {
    await env.IMAGES.put(m.row.original_key as string, new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]), {
      httpMetadata: { contentType: 'image/jpeg' },
    });
  }
  fx = {
    photo: photo.row.id as string,
    receipt: receipt.row.id as string,
    missing: missing.row.id as string,
  };
});

describe('POST /v1/images/:imageId/enhance (10 §6.1, T-300)', () => {
  it('queues one remove_bg job per catalog photo whose original is up', async () => {
    const first = await enhance(fx.photo);
    expect(first.status).toBe(202);
    const { job_id } = (await json(first)) as EnhanceResponse;
    expect(await job(job_id)).toEqual({ status: 'queued', attempts: 0, error: null, claimed_at: null });
    // Asked again while it waits: the same job.
    expect(((await json(await enhance(fx.photo, 'admin'))) as EnhanceResponse).job_id).toBe(job_id);
  });

  it('needs a session, a live catalog photo and its original', async () => {
    expect((await call('POST', `/v1/images/${fx.photo}/enhance`, {})).status).toBe(401);
    expect((await enhance(fx.receipt)).status).toBe(404);
    expect((await enhance(uuidv7())).status).toBe(404);
    const missing = await enhance(fx.missing);
    expect([missing.status, (await json(missing)).error.code]).toEqual([409, 'IMAGE_NOT_UPLOADED']);
    expect((await call('POST', '/v1/images/nope/enhance', { as: 'member' })).status).toBe(400);
  });
});

describe('image jobs for the home agent (07 §5.3, T-300)', () => {
  it('claims the oldest job once, with its original', async () => {
    const { job_id } = (await json(await enhance(fx.photo))) as EnhanceResponse;
    const res = await claim();
    expect(res.status).toBe(200);
    expect(((await json(res)) as AgentJobClaim).job).toEqual({
      id: job_id,
      image_id: fx.photo,
      op: 'remove_bg',
      original_url: `/agent/v1/images/${fx.photo}/original`,
      attempts: 1,
    });
    expect((await claim()).status).toBe(204);
    const original = await call('GET', `/agent/v1/images/${fx.photo}/original`, { token: AGENT });
    expect([original.status, original.headers.get('Content-Type')]).toEqual([200, 'image/jpeg']);
    expect([...new Uint8Array(await original.arrayBuffer())]).toEqual([0xff, 0xd8, 0xff, 1, 2, 3]);
    expect((await call('GET', `/agent/v1/images/${fx.missing}/original`, { token: AGENT })).status).toBe(404);
  });

  it('only answers the agent', async () => {
    await enhance(fx.photo);
    expect((await call('POST', '/agent/v1/jobs/claim', { as: 'admin' })).status).toBe(401);
    expect((await call('GET', `/agent/v1/images/${fx.photo}/original`, { as: 'admin' })).status).toBe(401);
  });

  it('keeps each result as a home rendition with a new version, and completes', async () => {
    const { job_id } = (await json(await enhance(fx.photo))) as EnhanceResponse;
    await claim();
    const before = (await env.DB.prepare(`SELECT value FROM sync_meta WHERE key = 'version'`).first<{
      value: number;
    }>())!.value;
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 9, 9, 9]);
    const res = await upload(job_id, 'processed', webp, 'image/webp', '?width=1024&height=1024');
    expect(res.status).toBe(201);
    const { rendition_id } = (await json(res)) as AgentJobResult;
    const row = await env.DB.prepare('SELECT * FROM image_renditions WHERE id = ?1')
      .bind(rendition_id)
      .first<Record<string, unknown>>();
    expect(row).toMatchObject({
      image_id: fx.photo,
      kind: 'processed',
      tier: 'home',
      r2_key: `images/${fx.photo}/${rendition_id}.webp`,
      width: 1024,
      height: 1024,
      bytes: 7,
      version: before + 1,
      deleted_at: null,
    });
    const object = await env.IMAGES.get(`images/${fx.photo}/${rendition_id}.webp`);
    expect([object?.httpMetadata?.contentType, object?.size]).toEqual(['image/webp', 7]);
    const mask = await upload(job_id, 'mask', new Uint8Array([0x89, 0x50]), 'image/png');
    const maskId = ((await json(mask)) as AgentJobResult).rendition_id;
    expect(
      await env.DB.prepare('SELECT r2_key, width FROM image_renditions WHERE id = ?1').bind(maskId).first(),
    ).toEqual({
      r2_key: `images/${fx.photo}/${maskId}.png`,
      width: null,
    });
    // The household gets them by pull.
    const pulled = await (
      await h.pull({ cursors: {} }, 'member')
    ).json<{ changes: Record<string, Array<{ id: string }>> }>();
    expect(pulled.changes.image_renditions!.map((r) => r.id).sort()).toEqual([rendition_id, maskId].sort());

    expect((await call('POST', `/agent/v1/jobs/${job_id}/complete`, { token: AGENT })).status).toBe(204);
    expect((await job(job_id))!.status).toBe('done');
    // A done job takes nothing more.
    expect((await upload(job_id, 'thumb', webp, 'image/webp')).status).toBe(404);
    expect((await call('POST', `/agent/v1/jobs/${job_id}/complete`, { token: AGENT })).status).toBe(404);
  });

  it('refuses a result of another type, size or job', async () => {
    const { job_id } = (await json(await enhance(fx.photo))) as EnhanceResponse;
    const bytes = new Uint8Array([1, 2, 3]);
    // Not claimed yet.
    expect((await upload(job_id, 'processed', bytes, 'image/webp')).status).toBe(404);
    await claim();
    expect((await upload(job_id, 'processed', bytes, 'image/png')).status).toBe(415);
    expect((await upload(job_id, 'mask', bytes, 'image/webp')).status).toBe(415);
    expect((await upload(job_id, 'original', bytes, 'image/webp')).status).toBe(400);
    expect((await upload(job_id, 'processed', bytes, 'image/webp', '?width=0')).status).toBe(400);
    expect((await upload(uuidv7(), 'processed', bytes, 'image/webp')).status).toBe(404);
    expect(await env.DB.prepare('SELECT count(*) AS n FROM image_renditions').first('n')).toBe(0);
  });

  it('retries a failed or abandoned job three times, then gives up', async () => {
    const { job_id } = (await json(await enhance(fx.photo))) as EnhanceResponse;
    await claim();
    const fail = (error: string) =>
      call('POST', `/agent/v1/jobs/${job_id}/fail`, { token: AGENT }, JSON.stringify({ error }), {
        'Content-Type': 'application/json',
      });
    expect((await fail('sin memoria')).status).toBe(204);
    expect(await job(job_id)).toEqual({
      status: 'queued',
      attempts: 1,
      error: 'sin memoria',
      claimed_at: null,
    });
    // The second try is abandoned: its lease runs out and a claim takes it again.
    await claim();
    await expire(job_id);
    // An agent past its lease cannot deliver any more.
    expect((await upload(job_id, 'processed', new Uint8Array([1]), 'image/webp')).status).toBe(404);
    expect(((await json(await claim())) as AgentJobClaim).job.attempts).toBe(3);
    expect((await fail('otra vez')).status).toBe(204);
    expect((await job(job_id))!.status).toBe('failed');
    expect((await claim()).status).toBe(204);
    // A job abandoned on its last try fails at the next claim.
    const other = ((await json(await enhance(fx.photo))) as EnhanceResponse).job_id;
    expect(other).not.toBe(job_id);
    await env.DB.prepare(
      `UPDATE image_jobs SET status = 'claimed', attempts = 3, claimed_at = ?1 WHERE id = ?2`,
    )
      .bind(Date.now() - 600001, other)
      .run();
    expect((await claim()).status).toBe(204);
    expect(await job(other)).toMatchObject({ status: 'failed', error: 'el agente no terminó a tiempo' });
    expect(
      (
        await call('POST', `/agent/v1/jobs/${job_id}/fail`, { token: AGENT }, '{}', {
          'Content-Type': 'application/json',
        })
      ).status,
    ).toBe(400);
  });
});

describe('the image reference tells what to adopt (10 §6.1, T-300)', () => {
  it('says while an enhancement waits, then which home renditions to adopt, until they are or it was edited', async () => {
    const p = product({ name: 'Toallas' });
    const photo = image(p.row.id as string);
    photo.row.original_key = `images/${photo.row.id}/original.jpg`;
    p.row.primary_image_id = photo.row.id;
    expect((await h.push([p, photo] as Mutation[], 'member')).status).toBe(200);
    await env.IMAGES.put(photo.row.original_key as string, new Uint8Array([1]));
    const ref = async () => {
      const res = await call('GET', `/v1/products/${p.row.id}`, { as: 'member' });
      return (await json(res)).product.image as {
        updated_at: number;
        enhance_pending: boolean;
        adopt: { processed_id: string; thumb_id: string } | null;
      };
    };
    expect(await ref()).toMatchObject({ enhance_pending: false, adopt: null });
    const asked = Date.now();
    const push = (row: Record<string, unknown>) =>
      h.push([{ table: 'images', row: { id: photo.row.id, updated_at: Date.now() + 10, ...row } }], 'member');
    expect((await push({ enhance_requested_at: asked })).status).toBe(200);
    const before = await ref();
    expect(before.enhance_pending).toBe(true);
    expect(before.updated_at).toBeGreaterThan(photo.row.updated_at as number);

    const { job_id } = (await json(await enhance(photo.row.id as string))) as EnhanceResponse;
    await claim();
    const webp = new Uint8Array([1, 2]);
    const processed = ((await json(await upload(job_id, 'processed', webp, 'image/webp'))) as AgentJobResult)
      .rendition_id;
    // A processed one alone is not adopted yet: it waits for its thumb.
    expect(await ref()).toMatchObject({ enhance_pending: false, adopt: null });
    const thumb = ((await json(await upload(job_id, 'thumb', webp, 'image/webp'))) as AgentJobResult)
      .rendition_id;
    expect((await ref()).adopt).toEqual({ processed_id: processed, thumb_id: thumb });

    // Once a client selects them, there is nothing to adopt.
    expect((await push({ selected_processed_id: processed, selected_thumb_id: thumb })).status).toBe(200);
    expect((await ref()).adopt).toBeNull();
    // A newer result is offered again, unless the photo was edited by hand.
    const newer = ((await json(await upload(job_id, 'thumb', webp, 'image/webp'))) as AgentJobResult)
      .rendition_id;
    expect((await ref()).adopt).toEqual({ processed_id: processed, thumb_id: newer });
    expect((await push({ edit_params: JSON.stringify({ manual: true }) })).status).toBe(200);
    expect((await ref()).adopt).toBeNull();
  });
});
