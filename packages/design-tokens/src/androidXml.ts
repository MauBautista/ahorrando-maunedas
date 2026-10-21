import { GENERATED_HEADER } from './css.ts';
import type { Tokens } from './schema.ts';

const snake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/**
 * Android color resources for what Compose cannot theme: the window background before the first frame and
 * the launcher icon. Light in `values/`, dark in `values-night/` with the same names.
 */
export function toAndroidColors(t: Tokens, theme: 'light' | 'dark'): string {
  const colors = {
    ...t.color[theme],
    ...Object.fromEntries(
      Object.entries(t.priceSource[theme]).map(([k, v]) => [`source${k[0]!.toUpperCase()}${k.slice(1)}`, v]),
    ),
  };
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<!-- ${GENERATED_HEADER} -->`,
    // The whole palette is generated on purpose (notifications, widgets); XML uses only part of it.
    '<resources xmlns:tools="http://schemas.android.com/tools" tools:ignore="UnusedResources">',
    ...Object.entries(colors).map(
      ([name, hex]) => `    <color name="maunedas_${snake(name)}">${hex.toUpperCase()}</color>`,
    ),
    '</resources>',
    '',
  ].join('\n');
}
