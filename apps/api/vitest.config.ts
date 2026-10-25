import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

const dir = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        // Extra databases only for schema tests: the design schema and the seed script are applied there.
        d1Databases: { DB: 'maunedas-test', REFERENCE_DB: 'reference-test', SEED_DB: 'seed-test' },
        bindings: {
          // Test-only secret for signed image URLs (real ones live in `wrangler secret`).
          IMAGE_URL_SECRET: 'test-image-url-secret',
          // A fake key, so a real one in .dev.vars never reaches a test (the provider is faked too).
          OPENROUTER_API_KEY: 'test-openrouter-key',
          TEST_MIGRATIONS: await readD1Migrations(dir('./migrations')),
          REFERENCE_SCHEMA: await readD1Migrations(dir('../../docs')),
          TEST_SEEDS: await readD1Migrations(dir('./seeds')),
          // Shared vectors (CLAUDE.md rule 7) for the price view and the history endpoint.
          NORMALIZATION_FIXTURE: JSON.parse(readFileSync(dir('../../fixtures/normalizacion.json'), 'utf8')),
        },
      },
    })),
  ],
  test: {
    setupFiles: ['./test/setup.ts'],
  },
});
