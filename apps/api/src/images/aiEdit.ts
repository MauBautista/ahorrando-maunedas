import {
  type AiEditQuote,
  type AiEditResponse,
  DEFAULT_AI_EDIT_PROMPT,
  MAX_UPLOAD_BYTES,
} from '@maunedas/shared/api/images';
import { uuidv7 } from '@maunedas/shared/util/uuid';
import { assertBudget, spentThisMonthUsd } from '../ai/budget';
import { providerFor, runAi } from '../ai/gateway';
import { InvalidAiOutput } from '../ai/types';
import type { Env } from '../env';
import { ApiError } from '../errors';
import { blobKey } from './blobs';
import { catalogPhoto } from './original';
import { signedBlobUrl } from './refs';

/** What a rendition may be (10 §1): an edit in another format is not usable. */
const EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/webp': 'webp' };

/**
 * The generative edit (10 §6.3, T-302): the budget is checked, the model gets the original by a signed URL, and its
 * image becomes a `processed` rendition with `tier='ai'` and a new sync version, as the home server's results. The
 * cost goes to `ai_usage`. An image that is not PNG or WebP, empty or over 15 MB is an unusable answer: billed, tried
 * once more, then `502`. The client makes the thumb when it adopts it.
 */
export async function aiEditImage(
  env: Env,
  fetchImpl: typeof fetch,
  imageId: string,
  prompt: string | undefined,
  userId: string,
  now: () => number = Date.now,
): Promise<AiEditResponse> {
  const photo = await catalogPhoto(env, imageId);
  const original = await signedBlobUrl(env, photo.original_key, now());
  const result = await runAi(
    env,
    fetchImpl,
    {
      purpose: 'image_edit',
      userId,
      run: async (provider) => {
        if (!provider.editImage) throw new ApiError(503, 'AI_UNAVAILABLE');
        const edit = await provider.editImage(original, prompt ?? DEFAULT_AI_EDIT_PROMPT);
        const ext = EXTENSIONS[edit.mime];
        if (!ext) throw new InvalidAiOutput(`formato ${edit.mime}`, edit.usage);
        if (edit.image.length > MAX_UPLOAD_BYTES) throw new InvalidAiOutput('imagen muy grande', edit.usage);
        return { data: { image: edit.image, mime: edit.mime, ext }, usage: edit.usage };
      },
    },
    now,
  );
  const id = uuidv7(now());
  const key = blobKey(imageId, `${id}.${result.data.ext}`);
  await env.IMAGES.put(key, result.data.image, { httpMetadata: { contentType: result.data.mime } });
  const at = now();
  await env.DB.batch([
    env.DB.prepare(`UPDATE sync_meta SET value = value + 1 WHERE key = 'version'`),
    env.DB.prepare(
      `INSERT INTO image_renditions (id, image_id, kind, tier, r2_key, width, height, bytes, created_at, updated_at, version)
       VALUES (?1, ?2, 'processed', 'ai', ?3, NULL, NULL, ?4, ?5, ?5, (SELECT value FROM sync_meta WHERE key = 'version'))`,
    ).bind(id, imageId, key, result.data.image.length, at),
  ]);
  return { rendition_id: id, url: await signedBlobUrl(env, key, at), cost_usd: result.cost_usd };
}

/**
 * Before confirming (10 §6.3): the estimate and this month's spending. Not available without a model chosen (the
 * gateway's `503`) or when one more edit would pass the month's budget, the same check `runAi` makes.
 */
export async function aiEditQuote(env: Env, now = Date.now()): Promise<AiEditQuote> {
  const estimate = Number(env.AI_IMAGE_EDIT_EST_COST_USD);
  const budget = Number(env.AI_MONTHLY_BUDGET_USD);
  const spent = await spentThisMonthUsd(env.DB, now);
  let reason: AiEditQuote['reason'] = null;
  try {
    providerFor(env, 'image_edit', fetch);
    await assertBudget(env, estimate, now);
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    reason = e.status === 402 ? 'BUDGET' : 'NOT_CONFIGURED';
  }
  return { available: reason === null, reason, estimate_usd: estimate, spent_usd: spent, budget_usd: budget };
}
