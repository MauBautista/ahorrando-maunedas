import { readFileSync } from 'node:fs';
import { toAndroidColors } from './androidXml.ts';
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

const ANDROID_RES = 'apps/android/core/designsystem/src/main/res';
export const ANDROID_COLORS_LIGHT = new URL(`${ANDROID_RES}/values/tokens_colors.xml`, ROOT);
export const ANDROID_COLORS_DARK = new URL(`${ANDROID_RES}/values-night/tokens_colors.xml`, ROOT);

export function loadTokens(): Tokens {
  return TokensSchema.parse(JSON.parse(readFileSync(TOKENS_FILE, 'utf8')));
}

/** Every generated file with its expected content. */
export function renderOutputs(tokens: Tokens): Array<{ file: URL; content: string }> {
  return [
    { file: CSS_FILE, content: toCss(tokens) },
    { file: KOTLIN_FILE, content: toKotlin(tokens) },
    { file: ANDROID_COLORS_LIGHT, content: toAndroidColors(tokens, 'light') },
    { file: ANDROID_COLORS_DARK, content: toAndroidColors(tokens, 'dark') },
  ];
}
