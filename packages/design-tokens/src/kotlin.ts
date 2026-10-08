import { GENERATED_HEADER } from './css.ts';
import type { Tokens } from './schema.ts';

export const KOTLIN_PACKAGE = 'com.maubautista.maunedas.core.designsystem';

const pascal = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const argb = (hex: string) => `0xFF${hex.slice(1).toUpperCase()}`;

function colorObject(name: string, colors: Record<string, string>): string[] {
  return [
    `    object ${name} {`,
    ...Object.entries(colors).map(([k, v]) => `        const val ${k}: Long = ${argb(v)}`),
    '    }',
  ];
}

function intObject(name: string, values: Record<string, number>, unit: string): string[] {
  return [
    `    /** Values in ${unit}. */`,
    `    object ${name} {`,
    ...Object.entries(values).map(([k, v]) => `        const val ${k}: Int = ${v}`),
    '    }',
  ];
}

/** Kotlin primitives only (ARGB Long, dp/sp Int) so the module needs no Compose until T-106. */
export function toKotlin(t: Tokens): string {
  const typography = Object.entries(t.typography).flatMap(([name, s]) => [
    `        object ${pascal(name)} {`,
    `            const val sizeSp: Int = ${s.size}`,
    `            const val lineHeightSp: Int = ${s.lineHeight}`,
    `            const val weight: Int = ${s.weight}`,
    '        }',
  ]);
  const lines = [
    `// ${GENERATED_HEADER}`,
    `package ${KOTLIN_PACKAGE}`,
    '',
    '/** Design tokens from packages/design-tokens/tokens.json. Colors are ARGB. */',
    'object Tokens {',
    ...colorObject('ColorLight', t.color.light),
    '',
    ...colorObject('ColorDark', t.color.dark),
    '',
    ...colorObject('PriceSourceLight', t.priceSource.light),
    '',
    ...colorObject('PriceSourceDark', t.priceSource.dark),
    '',
    '    object Typography {',
    ...typography,
    '    }',
    '',
    ...intObject('Spacing', t.spacing, 'dp'),
    '',
    ...intObject('Radius', t.radius, 'dp'),
    '',
    `    const val touchTargetMinDp: Int = ${t.touchTarget.min}`,
    '}',
  ];
  return `${lines.join('\n')}\n`;
}
