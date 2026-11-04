import { Buffer } from 'node:buffer';
import { ApiError } from '../../errors';
import type { AiProvider, AiUsage } from '../types';
import { InvalidAiOutput, RetryableAiError } from '../types';

export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const TIMEOUT_MS = 60_000;
/** An image takes longer to make than a receipt to read. */
const IMAGE_TIMEOUT_MS = 120_000;

interface OpenRouterEnv {
  OPENROUTER_API_KEY: string;
  PUBLIC_BASE_URL: string;
}

interface ChatCompletion {
  model?: string;
  choices?: Array<{
    message?: { content?: string | null; images?: Array<{ image_url?: { url?: string } }> };
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
}

/**
 * OpenRouter chat completions (09 §1): structured output for receipts, image output for edits. The key never leaves
 * this file's requests.
 */
export class OpenRouterProvider implements AiProvider {
  constructor(
    private readonly env: OpenRouterEnv,
    private readonly model: string,
    private readonly fetchImpl: typeof fetch,
    private readonly timeoutMs = TIMEOUT_MS,
    private readonly imageTimeoutMs = IMAGE_TIMEOUT_MS,
  ) {}

  /** One completion and what it cost; nothing that failed to answer is billed. */
  private async complete(body: object, timeoutMs: number): Promise<{ json: ChatCompletion; usage: AiUsage }> {
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
        // The real cost comes back in `usage.cost`.
        body: JSON.stringify({ model: this.model, usage: { include: true }, ...body }),
        signal: AbortSignal.timeout(timeoutMs),
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
    return {
      json,
      usage: {
        provider: 'openrouter',
        model: json.model ?? this.model,
        input_tokens: json.usage?.prompt_tokens ?? null,
        output_tokens: json.usage?.completion_tokens ?? null,
        cost_usd: typeof json.usage?.cost === 'number' ? json.usage.cost : null,
      },
    };
  }

  async extractReceipt(imageUrls: string[], systemPrompt: string, schema: object) {
    const { json, usage } = await this.complete(
      {
        temperature: 0,
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
      },
      this.timeoutMs,
    );
    const content = json.choices?.[0]?.message?.content;
    if (!content) throw new InvalidAiOutput('sin contenido', usage);
    try {
      return { data: JSON.parse(content) as unknown, usage };
    } catch {
      throw new InvalidAiOutput('JSON inválido', usage);
    }
  }

  /**
   * The photo goes by its signed URL (rule 13) and the edit comes back as a base64 data URL in `message.images`
   * (OpenRouter's image output), decoded natively so it costs little CPU.
   */
  async editImage(imageUrl: string, prompt: string) {
    const { json, usage } = await this.complete(
      {
        modalities: ['image', 'text'],
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: imageUrl } },
            ],
          },
        ],
      },
      this.imageTimeoutMs,
    );
    const url = json.choices?.[0]?.message?.images?.[0]?.image_url?.url ?? '';
    // Only the header is matched: the data can be megabytes.
    const comma = url.indexOf(',');
    const mime = /^data:(image\/[a-z+.-]+);base64$/.exec(url.slice(0, comma))?.[1];
    if (comma < 0 || !mime) throw new InvalidAiOutput('sin imagen', usage);
    const image = new Uint8Array(Buffer.from(url.slice(comma + 1), 'base64'));
    if (image.length === 0) throw new InvalidAiOutput('imagen vacía', usage);
    return { image, mime, usage };
  }
}
