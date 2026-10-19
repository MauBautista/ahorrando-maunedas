import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';

// Real migrations on the test database before every test file (already-applied ones are skipped).
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
