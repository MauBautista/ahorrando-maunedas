import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadTokens, renderOutputs } from '../src/outputs.ts';

for (const { file, content } of renderOutputs(loadTokens())) {
  mkdirSync(new URL('.', file), { recursive: true });
  writeFileSync(file, content);
  console.log(`design-tokens: wrote ${fileURLToPath(file)}`);
}
