/** What a provider reports for one call (09 §1); `cost_usd` is the real cost when the provider says it. */
export interface AiUsage {
  provider: string;
  model: string;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
}

export type AiPurpose = 'receipt' | 'image_edit' | 'other';

export interface AiProvider {
  extractReceipt(
    imageUrls: string[],
    systemPrompt: string,
    schema: object,
  ): Promise<{ data: unknown; usage: AiUsage }>;
}

/** The provider is down or busy (5xx, 429) or did not answer in time: worth one more try, nothing to bill. */
export class RetryableAiError extends Error {
  constructor(readonly status: number | null) {
    super(status === null ? 'timeout' : `HTTP ${status}`);
    this.name = 'RetryableAiError';
  }
}

/** The model answered something unusable: it was billed ([usage]), and one more try is allowed. */
export class InvalidAiOutput extends Error {
  constructor(
    reason: string,
    readonly usage: AiUsage | null = null,
  ) {
    super(reason);
    this.name = 'InvalidAiOutput';
  }
}
