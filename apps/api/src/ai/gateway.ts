import type { Env } from '../env';
import { ApiError } from '../errors';
import { log } from '../util/log';
import { assertBudget, recordUsage } from './budget';
import { OpenRouterProvider } from './providers/openrouter';
import type { AiProvider, AiUsage } from './types';
import { InvalidAiOutput, RetryableAiError } from './types';

/**
 * The only place that knows providers and keys (CLAUDE.md rule 8, 09 §1): the provider and model come from the
 * environment, and a model still to be chosen ("<se define en el spike C>") means the feature is off.
 */
export function providerFor(
  env: Env,
  purpose: 'receipt' | 'image_edit',
  fetchImpl: typeof fetch,
): AiProvider {
  const name = purpose === 'receipt' ? env.AI_RECEIPT_PROVIDER : env.AI_IMAGE_EDIT_PROVIDER;
  const model = purpose === 'receipt' ? env.AI_RECEIPT_MODEL : env.AI_IMAGE_EDIT_MODEL;
  if (!model || model.startsWith('<')) throw new ApiError(503, 'AI_UNAVAILABLE');
  switch (name) {
    case 'openrouter':
      if (!env.OPENROUTER_API_KEY) throw new ApiError(503, 'AI_UNAVAILABLE');
      return new OpenRouterProvider(env, model, fetchImpl);
    default:
      throw new ApiError(503, 'AI_UNAVAILABLE');
  }
}

export interface AiCall<T> {
  purpose: 'receipt' | 'image_edit';
  userId: string | null;
  /** The call itself; it throws [InvalidAiOutput] (with its usage) when the answer does not validate. */
  run: (provider: AiProvider) => Promise<{ data: T; usage: AiUsage }>;
  requestId?: string;
}

/** What one call to the model cost and returned. */
export interface AiResult<T> {
  data: T;
  usage: AiUsage;
  cost_usd: number;
}

const ATTEMPTS = 2;

/**
 * One model call under the budget (09 §1–2): the budget is checked before each attempt; an answer, good or
 * unusable, is billed in `ai_usage` (the reported cost, or the estimate); one more try follows a timeout, a 5xx or
 * 429, or an unusable answer. Afterwards: an unusable answer is `422 E-EXTRACTION_FAILED` for a receipt, a
 * provider that did not answer is `503 E-AI_UNAVAILABLE`.
 */
export async function runAi<T>(
  env: Env,
  fetchImpl: typeof fetch,
  call: AiCall<T>,
  now: () => number = Date.now,
): Promise<AiResult<T>> {
  const provider = providerFor(env, call.purpose, fetchImpl);
  const estimate = Number(
    call.purpose === 'receipt' ? env.AI_RECEIPT_EST_COST_USD : env.AI_IMAGE_EDIT_EST_COST_USD,
  );
  let last: unknown;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    await assertBudget(env, estimate, now());
    try {
      const { data, usage } = await call.run(provider);
      const cost = await recordUsage(env, call.purpose, call.userId, usage, estimate, now());
      return { data, usage, cost_usd: cost };
    } catch (e) {
      if (e instanceof InvalidAiOutput) {
        await recordUsage(
          env,
          call.purpose,
          call.userId,
          e.usage ?? {
            provider: 'unknown',
            model: 'unknown',
            input_tokens: null,
            output_tokens: null,
            cost_usd: null,
          },
          estimate,
          now(),
        );
      } else if (!(e instanceof RetryableAiError)) {
        throw e;
      }
      log('warn', 'ai_attempt_failed', {
        purpose: call.purpose,
        attempt,
        error: e.message,
        request_id: call.requestId,
      });
      last = e;
    }
  }
  if (last instanceof InvalidAiOutput) {
    throw call.purpose === 'receipt'
      ? new ApiError(422, 'EXTRACTION_FAILED')
      : new ApiError(502, 'UPSTREAM_ERROR', { service: 'ai' });
  }
  throw new ApiError(503, 'AI_UNAVAILABLE');
}
