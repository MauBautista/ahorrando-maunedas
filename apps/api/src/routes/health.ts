import { Hono } from 'hono';
import { readSyncMeta } from '../db/meta';
import type { AppEnv } from '../env';
import { API_VERSION } from '../version';

/** Public route (03 §4). Reading `sync_meta` also proves the database is reachable and migrated. */
export const health = new Hono<AppEnv>().get('/v1/health', async (c) => {
  const { schemaVersion } = await readSyncMeta(c.env.DB);
  return c.json({ ok: true, version: API_VERSION, schema_version: schemaVersion });
});
