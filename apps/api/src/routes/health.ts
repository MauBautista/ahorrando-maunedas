import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { API_VERSION, SCHEMA_VERSION } from '../version';

/** Public route (03 §4). */
export const health = new Hono<AppEnv>().get('/v1/health', (c) =>
  c.json({ ok: true, version: API_VERSION, schema_version: SCHEMA_VERSION }),
);
