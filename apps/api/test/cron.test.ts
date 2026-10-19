import { env } from 'cloudflare:workers';
import { createScheduledController } from 'cloudflare:test';
import { uuidv7 } from '@maunedas/shared/util/uuid';
import { beforeEach, describe, expect, it } from 'vitest';
import { isMaintenanceTick } from '../src/cron/maintenance';
import worker from '../src/index';

const DAY = 86_400_000;
/** 04:07 in Mexico City (UTC−6 all year since 2022). */
const MAINTENANCE = Date.UTC(2026, 9, 20, 10, 7);

async function tick(scheduledTime: number) {
  const controller = createScheduledController({ scheduledTime, cron: '7 * * * *' });
  await worker.scheduled(controller, env as never);
}

const ids = async (table: string, key = 'id') =>
  (await env.DB.prepare(`SELECT ${key} AS k FROM ${table} ORDER BY ${key}`).all<{ k: string }>()).results.map(
    (r) => r.k,
  );

let imageId: string;

beforeEach(async () => {
  imageId = uuidv7();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM image_jobs'),
    env.DB.prepare('DELETE FROM token_cache'),
    env.DB.prepare('DELETE FROM off_cache'),
    env.DB.prepare(
      `INSERT INTO images (id, owner_type, owner_id, role, source, created_at, updated_at)
       VALUES (?1, 'product', ?1, 'catalog', 'user', 1, 1)`,
    ).bind(imageId),
  ]);
  const now = MAINTENANCE;
  const job = (id: string, status: string, updatedAt: number) =>
    env.DB.prepare(
      `INSERT INTO image_jobs (id, image_id, op, status, created_at, updated_at) VALUES (?1, ?2, 'remove_bg', ?3, ?4, ?4)`,
    ).bind(id, imageId, status, updatedAt);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO token_cache (key, value, expires_at) VALUES (?1, ?2, ?3)').bind(
      'expired',
      'x',
      now - 1,
    ),
    env.DB.prepare('INSERT INTO token_cache (key, value, expires_at) VALUES (?1, ?2, ?3)').bind(
      'valid',
      'x',
      now + 60_000,
    ),
    env.DB.prepare('INSERT INTO off_cache (code, found, fetched_at) VALUES (?1, 1, ?2)').bind(
      'hit-31d',
      now - 31 * DAY,
    ),
    env.DB.prepare('INSERT INTO off_cache (code, found, fetched_at) VALUES (?1, 1, ?2)').bind(
      'hit-29d',
      now - 29 * DAY,
    ),
    env.DB.prepare('INSERT INTO off_cache (code, found, fetched_at) VALUES (?1, 0, ?2)').bind(
      'miss-8d',
      now - 8 * DAY,
    ),
    env.DB.prepare('INSERT INTO off_cache (code, found, fetched_at) VALUES (?1, 0, ?2)').bind(
      'miss-6d',
      now - 6 * DAY,
    ),
    job('a-done-31d', 'done', now - 31 * DAY),
    job('b-failed-31d', 'failed', now - 31 * DAY),
    job('c-done-29d', 'done', now - 29 * DAY),
    job('d-queued-60d', 'queued', now - 60 * DAY),
    job('e-claimed-60d', 'claimed', now - 60 * DAY),
  ]);
});

describe('daily maintenance (T-041, 03 §2)', () => {
  it('runs only on the 04:07 Mexico City tick, all year', () => {
    expect(isMaintenanceTick(MAINTENANCE)).toBe(true);
    expect(isMaintenanceTick(Date.UTC(2026, 6, 15, 10, 7))).toBe(true);
    expect(isMaintenanceTick(MAINTENANCE - 3_600_000)).toBe(false);
    expect(isMaintenanceTick(MAINTENANCE + 3_600_000)).toBe(false);
    expect(isMaintenanceTick(Date.UTC(2026, 9, 20, 4, 7))).toBe(false);
  });

  it('deletes expired tokens, stale catalog entries and old finished image jobs', async () => {
    await tick(MAINTENANCE);
    expect(await ids('token_cache', 'key')).toEqual(['valid']);
    expect(await ids('off_cache', 'code')).toEqual(['hit-29d', 'miss-6d']);
    expect(await ids('image_jobs')).toEqual(['c-done-29d', 'd-queued-60d', 'e-claimed-60d']);
  });

  it('any other hour changes nothing', async () => {
    await tick(MAINTENANCE + 3_600_000);
    expect(await ids('token_cache', 'key')).toHaveLength(2);
    expect(await ids('off_cache', 'code')).toHaveLength(4);
    expect(await ids('image_jobs')).toHaveLength(5);
  });
});
