import { env } from 'cloudflare:workers';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertBudget,
  budgetSummary,
  checkSoftLimit,
  monthWindow,
  recordUsage,
  spentThisMonthUsd,
} from '../src/ai/budget';
import { runAi } from '../src/ai/gateway';
import { OPENROUTER_URL } from '../src/ai/providers/openrouter';
import { type AiProvider, InvalidAiOutput } from '../src/ai/types';
import type { Env } from '../src/env';
import { ApiError } from '../src/errors';
import { ADMIN_ID, syncHarness } from './support/sync';

const OCT_15 = Date.UTC(2026, 9, 15, 18); // 2026-10-15 12:00 in Mexico City
/** A model is chosen in spike C; the tests use their own. */
const aiEnv = { ...env, AI_RECEIPT_MODEL: 'test/vision-model' } as unknown as Env;

async function usageAt(createdAt: number, costUsd: number, purpose = 'receipt') {
  await env.DB.prepare(
    `INSERT INTO ai_usage (id, purpose, provider, model, user_id, input_tokens, output_tokens, cost_usd_micros, created_at)
     VALUES (?1, ?2, 'openrouter', 'm', NULL, NULL, NULL, ?3, ?4)`,
  )
    .bind(crypto.randomUUID(), purpose, Math.round(costUsd * 1e6), createdAt)
    .run();
}

const rows = async () =>
  (
    await env.DB.prepare(
      `SELECT purpose, provider, model, user_id, input_tokens, output_tokens, cost_usd_micros FROM ai_usage ORDER BY created_at, id`,
    ).all()
  ).results;

/** A fake OpenRouter: answers in order and keeps what was asked. */
/** The parts of a chat completion request the tests read. */
interface ChatRequest {
  model: string;
  messages: Array<{ role: string; content: string | Array<{ text?: string; image_url?: { url: string } }> }>;
  [key: string]: unknown;
}

function fakeOpenRouter(answers: Array<Response | Error>) {
  const requests: Array<{ url: string; headers: Headers; body: ChatRequest }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    requests.push({
      url: String(input),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)),
    });
    const next = answers.shift();
    if (!next) throw new Error('no more answers');
    if (next instanceof Error) throw next;
    return next;
  };
  return { fetchImpl, requests };
}

/** [cost] null: the provider does not say what it cost. */
const completion = (content: string | null, cost: number | null = 0.0042) =>
  Response.json({
    model: 'test/vision-model-2026',
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 1200, completion_tokens: 800, ...(cost === null ? {} : { cost }) },
  });

const receiptCall = (userId: string | null = ADMIN_ID) => ({
  purpose: 'receipt' as const,
  userId,
  run: (p: AiProvider) => p.extractReceipt(['https://img/1', 'https://img/2'], 'sistema', { type: 'object' }),
});

let h: Awaited<ReturnType<typeof syncHarness>>;
const get = (path: string, as: 'admin' | 'member') =>
  h.app.request(path, { headers: { Authorization: `Bearer ${h.tokens[as]}` } }, env as never);
beforeAll(async () => {
  h = await syncHarness();
});
beforeEach(async () => {
  await h.reset();
});

describe('monthWindow (09 §2)', () => {
  it('is the calendar month in Mexico City, UTC−6 with no daylight saving time', () => {
    // 2026-10-31 23:59:59.999 in Mexico City is still October; one millisecond later it is November.
    const lastMs = Date.UTC(2026, 10, 1, 5, 59, 59, 999);
    expect(monthWindow(lastMs)).toEqual({
      key: '2026-10',
      start: Date.UTC(2026, 9, 1, 6),
      end: Date.UTC(2026, 10, 1, 6),
    });
    expect(monthWindow(lastMs + 1).key).toBe('2026-11');
    // New year: December runs until 06:00 UTC on January 1st.
    expect(monthWindow(Date.UTC(2027, 0, 1, 5, 59)).key).toBe('2026-12');
    expect(monthWindow(Date.UTC(2027, 0, 1, 6)).key).toBe('2027-01');
    expect(monthWindow(Date.UTC(2026, 11, 20)).end).toBe(Date.UTC(2027, 0, 1, 6));
  });
});

describe('budget', () => {
  it('only this month counts, and an estimate that would pass the budget is refused', async () => {
    await usageAt(Date.UTC(2026, 9, 1, 5, 59), 3); // September in Mexico City
    await usageAt(Date.UTC(2026, 9, 1, 6), 5.995); // October
    expect(await spentThisMonthUsd(env.DB, OCT_15)).toBe(5.995);
    // Landing exactly on the budget is allowed; one micro-dollar more is not.
    await expect(assertBudget(env, 0.005, OCT_15)).resolves.toBeUndefined();
    const refused = await assertBudget(env, 0.005001, OCT_15).catch((e) => e);
    expect(refused).toBeInstanceOf(ApiError);
    expect([refused.status, refused.code, refused.details]).toEqual([
      402,
      'AI_BUDGET_EXCEEDED',
      { spent_usd: 5.995, budget_usd: 6 },
    ]);
  });

  it('records the reported cost or the estimate, and warns once a month past the soft limit', async () => {
    const usage = { provider: 'openrouter', model: 'm', input_tokens: 10, output_tokens: 5, cost_usd: 4.79 };
    expect(await recordUsage(env, 'receipt', ADMIN_ID, usage, 0.01, OCT_15)).toBe(4.79);
    expect(await recordUsage(env, 'receipt', null, { ...usage, cost_usd: null }, 0.01, OCT_15 + 1)).toBe(
      0.01,
    );
    expect((await rows()).map((r) => [r.user_id, r.cost_usd_micros])).toEqual([
      [ADMIN_ID, 4_790_000],
      [null, 10_000],
    ]);
    // 4.80 of 6 USD is 80 %: the mark is written by the call that crossed it, and only once.
    const mark = await env.DB.prepare(
      `SELECT value, expires_at FROM token_cache WHERE key = 'ai_soft:2026-10'`,
    ).first();
    expect(mark).toEqual({ value: String(OCT_15 + 1), expires_at: Date.UTC(2026, 10, 1, 6) + 86_400_000 });
    expect(await checkSoftLimit(env, OCT_15 + 2)).toBe(false);
    // Next month starts below it again.
    expect(await checkSoftLimit(env, Date.UTC(2026, 10, 10))).toBe(false);
  });

  it('summarizes the month by purpose for the admin', async () => {
    await usageAt(OCT_15, 0.25, 'receipt');
    await usageAt(OCT_15 + 1, 0.5, 'receipt');
    await usageAt(OCT_15 + 2, 0.04, 'image_edit');
    await usageAt(Date.UTC(2026, 8, 20), 9, 'receipt'); // September
    expect(await budgetSummary(env, OCT_15)).toEqual({
      month: '2026-10',
      budget_usd: 6,
      spent_usd: 0.79,
      soft_limit_pct: 80,
      soft_limit_reached: false,
      by_purpose: { receipt: 0.75, image_edit: 0.04, other: 0 },
      calls: 3,
    });
  });
});

describe('runAi (09 §1)', () => {
  it('calls OpenRouter with structured output and bills the reported cost', async () => {
    const { fetchImpl, requests } = fakeOpenRouter([completion('{"lines":[]}')]);
    const result = await runAi(aiEnv, fetchImpl, receiptCall(), () => OCT_15);
    expect(result).toEqual({
      data: { lines: [] },
      usage: {
        provider: 'openrouter',
        model: 'test/vision-model-2026',
        input_tokens: 1200,
        output_tokens: 800,
        cost_usd: 0.0042,
      },
      cost_usd: 0.0042,
    });
    const [req] = requests;
    expect(req!.url).toBe(OPENROUTER_URL);
    expect(req!.headers.get('Authorization')).toBe('Bearer test-openrouter-key');
    expect(req!.body).toMatchObject({
      model: 'test/vision-model',
      temperature: 0,
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'receipt', strict: true, schema: { type: 'object' } },
      },
    });
    const user = req!.body.messages[1]!.content as Array<{ text?: string; image_url?: { url: string } }>;
    expect(user.map((c) => c.image_url?.url ?? c.text)).toEqual([
      'Extrae este ticket.',
      'https://img/1',
      'https://img/2',
    ]);
    expect(await rows()).toEqual([
      {
        purpose: 'receipt',
        provider: 'openrouter',
        model: 'test/vision-model-2026',
        user_id: ADMIN_ID,
        input_tokens: 1200,
        output_tokens: 800,
        cost_usd_micros: 4200,
      },
    ]);
  });

  it('tries once more after a busy provider or a timeout, billing only answers', async () => {
    const busy = fakeOpenRouter([new Response('busy', { status: 503 }), completion('{}', null)]);
    const ok = await runAi(aiEnv, busy.fetchImpl, receiptCall(), () => OCT_15);
    // No cost reported: the estimate is billed.
    expect([busy.requests.length, ok.cost_usd]).toEqual([2, 0.01]);
    const timeout = fakeOpenRouter([
      new DOMException('timed out', 'TimeoutError'),
      new Response('slow', { status: 429 }),
    ]);
    const down = await runAi(aiEnv, timeout.fetchImpl, receiptCall(), () => OCT_15).catch((e) => e);
    expect([down.status, down.code, timeout.requests.length]).toEqual([503, 'AI_UNAVAILABLE', 2]);
    expect((await rows()).map((r) => r.cost_usd_micros)).toEqual([10_000]);
  });

  it('bills an unusable answer and fails the receipt after the second one', async () => {
    const { fetchImpl, requests } = fakeOpenRouter([completion('no es json'), completion(null)]);
    const failed = await runAi(aiEnv, fetchImpl, receiptCall(), () => OCT_15).catch((e) => e);
    expect([failed.status, failed.code, requests.length]).toEqual([422, 'EXTRACTION_FAILED', 2]);
    expect((await rows()).map((r) => r.cost_usd_micros)).toEqual([4200, 4200]);
    // A caller's own check (the receipt schema, T-040) is billed the same way.
    const invalid = fakeOpenRouter([completion('{}'), completion('{"ok":true}')]);
    let seen = 0;
    const second = await runAi(
      aiEnv,
      invalid.fetchImpl,
      {
        purpose: 'receipt',
        userId: null,
        run: async (p) => {
          const r = await p.extractReceipt([], 's', {});
          if (++seen === 1) throw new InvalidAiOutput('esquema', r.usage);
          return r;
        },
      },
      () => OCT_15,
    );
    expect(second.data).toEqual({ ok: true });
    expect((await rows()).length).toBe(4);
  });

  it('is off without a model or a key, refuses past the budget and does not retry a bad request', async () => {
    const none = fakeOpenRouter([]);
    for (const off of [
      env as unknown as Env,
      { ...aiEnv, OPENROUTER_API_KEY: '' } as unknown as Env,
      { ...aiEnv, AI_RECEIPT_PROVIDER: 'otro' } as unknown as Env,
    ]) {
      const e = await runAi(off, none.fetchImpl, receiptCall(), () => OCT_15).catch((x) => x);
      expect([e.status, e.code]).toEqual([503, 'AI_UNAVAILABLE']);
    }
    await usageAt(OCT_15, 5.995);
    const broke = await runAi(aiEnv, none.fetchImpl, receiptCall(), () => OCT_15).catch((x) => x);
    expect([broke.status, broke.code]).toEqual([402, 'AI_BUDGET_EXCEEDED']);
    expect(none.requests.length).toBe(0);
    await h.reset();
    const bad = fakeOpenRouter([new Response('{"error":"bad"}', { status: 400 })]);
    const e = await runAi(aiEnv, bad.fetchImpl, receiptCall(), () => OCT_15).catch((x) => x);
    expect([e.status, e.code, e.details, bad.requests.length]).toEqual([
      502,
      'UPSTREAM_ERROR',
      { service: 'openrouter', status: 400 },
      1,
    ]);
  });
});

describe('GET /v1/admin/ai-budget', () => {
  it('is the admin’s, with this month’s spend and the soft limit', async () => {
    const now = Date.now();
    await usageAt(now, 4.5);
    await usageAt(now, 0.4, 'other');
    expect((await get('/v1/admin/ai-budget', 'member')).status).toBe(403);
    const res = await get('/v1/admin/ai-budget', 'admin');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      month: monthWindow(now).key,
      budget_usd: 6,
      spent_usd: 4.9,
      soft_limit_pct: 80,
      soft_limit_reached: true,
      by_purpose: { receipt: 4.5, image_edit: 0, other: 0.4 },
      calls: 2,
    });
  });
});
