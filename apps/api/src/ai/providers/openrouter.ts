import { ApiError } from '../../errors';
import type { AiProvider, AiUsage } from '../types';
import { InvalidAiOutput, RetryableAiError } from '../types';

export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const TIMEOUT_MS = 60_000;

interface OpenRouterEnv {
  OPENROUTER_API_KEY: string;
  PUBLIC_BASE_URL: string;
}

interface ChatCompletion {
  model?: string;
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
}

/** OpenRouter chat completions with structured output (09 §1). The key never leaves this file's requests. */
export class OpenRouterProvider implements AiProvider {
  constructor(
    private readonly env: OpenRouterEnv,
    private readonly model: string,
    private readonly fetchImpl: typeof fetch,
    private readonly timeoutMs = TIMEOUT_MS,
  ) {}

  async extractReceipt(imageUrls: string[], systemPrompt: string, schema: object) {
    let res: Response;
    try {
      res = await this.fetchImpl(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': this.env.PUBLIC_BASE_URL,
          'X-Title': 'Ahorrando Maunedas',
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0,
          // The real cost comes back in `usage.cost`.
          usage: { include: true },
          messages: [
            { role: 'system', content: systemPrompt },
            {
              role: 'user',
              content: [
                { type: 'text', text: 'Extrae este ticket.' },
                ...imageUrls.map((url) => ({ type: 'image_url', image_url: { url } })),
              ],
            },
          ],
          response_format: { type: 'json_schema', json_schema: { name: 'receipt', strict: true, schema } },
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      // A timeout or a dropped connection: nothing came back, so nothing to bill.
      if (
        e instanceof Error &&
        (e.name === 'TimeoutError' || e.name === 'AbortError' || e instanceof TypeError)
      ) {
        throw new RetryableAiError(null);
      }
      throw e;
    }
    if (res.status >= 500 || res.status === 429) throw new RetryableAiError(res.status);
    if (!res.ok) throw new ApiError(502, 'UPSTREAM_ERROR', { service: 'openrouter', status: res.status });

    const json = await res.json<ChatCompletion>();
    const usage: AiUsage = {
      provider: 'openrouter',
      model: json.model ?? this.model,
      input_tokens: json.usage?.prompt_tokens ?? null,
      output_tokens: json.usage?.completion_tokens ?? null,
      cost_usd: typeof json.usage?.cost === 'number' ? json.usage.cost : null,
    };
    const content = json.choices?.[0]?.message?.content;
    if (!content) throw new InvalidAiOutput('sin contenido', usage);
    try {
      return { data: JSON.parse(content) as unknown, usage };
    } catch {
      throw new InvalidAiOutput('JSON inválido', usage);
    }
  }
}
