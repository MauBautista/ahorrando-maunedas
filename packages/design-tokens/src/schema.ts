import { z } from 'zod';

const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'color #RRGGBB');
const size = z.number().int().positive();

const palette = z.strictObject({
  primary: hex,
  onPrimary: hex,
  surface: hex,
  onSurface: hex,
  surfaceVariant: hex,
  onSurfaceVariant: hex,
  outline: hex,
  error: hex,
  onError: hex,
  warning: hex,
  onWarning: hex,
  success: hex,
  onSuccess: hex,
});

/** Price source colors: paid (purchase), shelf and web (ARQUITECTURA §3.3). */
const priceSource = z.strictObject({ purchase: hex, shelf: hex, web: hex });

const textStyle = z.strictObject({ size, lineHeight: size, weight: z.number().int().min(100).max(900) });

export const TokensSchema = z.strictObject({
  $description: z.string(),
  color: z.strictObject({ light: palette, dark: palette }),
  priceSource: z.strictObject({ light: priceSource, dark: priceSource }),
  typography: z.record(z.string().regex(/^[a-z][a-zA-Z]*$/), textStyle),
  spacing: z.record(z.string().regex(/^[a-z][a-zA-Z0-9]*$/), z.number().int().nonnegative()),
  radius: z.record(z.string().regex(/^[a-z][a-zA-Z0-9]*$/), z.number().int().nonnegative()),
  touchTarget: z.strictObject({ min: size }),
});

export type Tokens = z.infer<typeof TokensSchema>;
export type Palette = z.infer<typeof palette>;

/** Pairs of foreground/background that carry text and must reach WCAG AA (RNF-08). */
export const TEXT_PAIRS: ReadonlyArray<readonly [keyof Palette, keyof Palette]> = [
  ['onPrimary', 'primary'],
  ['onSurface', 'surface'],
  ['onSurfaceVariant', 'surfaceVariant'],
  ['onError', 'error'],
  ['onWarning', 'warning'],
  ['onSuccess', 'success'],
];
