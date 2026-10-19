import type { D1Migration } from 'cloudflare:test';

// Bindings that exist only in tests (vitest.config.ts).
declare global {
  namespace Cloudflare {
    interface Env {
      REFERENCE_DB: D1Database;
      SEED_DB: D1Database;
      TEST_MIGRATIONS: D1Migration[];
      REFERENCE_SCHEMA: D1Migration[];
      TEST_SEEDS: D1Migration[];
      NORMALIZATION_FIXTURE: unknown;
    }
  }
}
