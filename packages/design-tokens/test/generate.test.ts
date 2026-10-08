import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contrastRatio } from '../src/contrast.ts';
import { toCss } from '../src/css.ts';
import { toKotlin } from '../src/kotlin.ts';
import { loadTokens, renderOutputs } from '../src/outputs.ts';
import { TEXT_PAIRS } from '../src/schema.ts';

const tokens = loadTokens();

describe('tokens.json', () => {
  it.each(['light', 'dark'] as const)('text pairs reach WCAG AA (4.5:1) in %s mode', (mode) => {
    const p = tokens.color[mode];
    for (const [fg, bg] of TEXT_PAIRS) {
      expect(contrastRatio(p[fg], p[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(['light', 'dark'] as const)('price source marks reach 3:1 on the surface in %s mode', (mode) => {
    for (const [source, color] of Object.entries(tokens.priceSource[mode])) {
      expect(contrastRatio(color, tokens.color[mode].surface), source).toBeGreaterThanOrEqual(3);
    }
  });

  it('keeps touch targets at 48 dp or more (RNF-08)', () => {
    expect(tokens.touchTarget.min).toBeGreaterThanOrEqual(48);
  });
});

describe('generators', () => {
  it('writes CSS variables for both themes', () => {
    const css = toCss(tokens);
    expect(css).toContain('--mn-color-primary: #1b6b3a;');
    expect(css).toContain('--mn-price-shelf: #b26a00;');
    expect(css).toContain('--mn-font-body-size: 1rem;');
    expect(css).toContain("@media (prefers-color-scheme: dark) {\n  :root:not([data-theme='light']) {");
    expect(css).toContain('--mn-color-primary: #7dd99a;');
  });

  it('writes Kotlin primitives', () => {
    const kt = toKotlin(tokens);
    expect(kt).toContain('package com.maubautista.maunedas.core.designsystem');
    expect(kt).toContain('const val primary: Long = 0xFF1B6B3A');
    expect(kt).toContain('const val sizeSp: Int = 16');
    expect(kt).toContain('const val touchTargetMinDp: Int = 48');
  });

  it('is deterministic', () => {
    expect(toCss(tokens)).toBe(toCss(loadTokens()));
    expect(toKotlin(tokens)).toBe(toKotlin(loadTokens()));
  });

  it.each(renderOutputs(tokens))('generated file is up to date: $file.pathname', ({ file, content }) => {
    expect(readFileSync(file, 'utf8')).toBe(content);
  });
});
