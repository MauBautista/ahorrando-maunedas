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
          TEST_MIGRATIONS: await readD1Migrations(dir('./migrations')),
          REFERENCE_SCHEMA: await readD1Migrations(dir('../../docs')),
          TEST_SEEDS: await readD1Migrations(dir('./seeds')),
        },
      },
    })),
  ],
  test: {
    setupFiles: ['./test/setup.ts'],
  },
});
