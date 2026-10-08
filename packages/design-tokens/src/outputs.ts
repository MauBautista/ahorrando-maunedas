import { readFileSync } from 'node:fs';
import { toCss } from './css.ts';
import { toKotlin } from './kotlin.ts';
import { TokensSchema, type Tokens } from './schema.ts';

const ROOT = new URL('../../../', import.meta.url);

export const TOKENS_FILE = new URL('packages/design-tokens/tokens.json', ROOT);
export const CSS_FILE = new URL('apps/web/src/styles/tokens.css', ROOT);
export const KOTLIN_FILE = new URL(
  'apps/android/core/designsystem/src/main/kotlin/com/maubautista/maunedas/core/designsystem/Tokens.kt',
  ROOT,
);

export function loadTokens(): Tokens {
  return TokensSchema.parse(JSON.parse(readFileSync(TOKENS_FILE, 'utf8')));
}

/** Every generated file with its expected content. */
export function renderOutputs(tokens: Tokens): Array<{ file: URL; content: string }> {
  return [
    { file: CSS_FILE, content: toCss(tokens) },
    { file: KOTLIN_FILE, content: toKotlin(tokens) },
  ];
}
