import type { PushResponse } from '@maunedas/shared/api/sync';
import { PUSH_MAX_MUTATIONS } from '@maunedas/shared/api/sync';
import { uuidv7 } from '@maunedas/shared/util/uuid';
import type { Api } from './api';

/** One row to push (04 §3.1): the web keeps no local copy, it writes and then refreshes its queries (04 §7). */
export interface Mutation {
  table: string;
  row: Record<string, unknown>;
}

const DEVICE_KEY = 'maunedas.device_id';
let sessionDevice: string | null = null;

/** A UUID kept in `localStorage`; if storage is not available, one per session (04 §7). */
export function webDeviceId(): string {
  try {
    const saved = localStorage.getItem(DEVICE_KEY);
    if (saved) return saved;
    const id = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, id);
    return id;
  } catch {
    sessionDevice ??= crypto.randomUUID();
    return sessionDevice;
  }
}

export function newRow<T extends object>(fields: T, now = Date.now()) {
  return { id: uuidv7(now), created_at: now, updated_at: now, deleted_at: null, ...fields };
}

/** The `updated_at` of a change to a row read with [updatedAt]: later than both now and the row (04 §3.2 `STALE`). */
export function touchedAt(updatedAt: number, now = Date.now()): number {
  return Math.max(now, updatedAt + 1);
}

/** Pushes in order, at most 100 rows per request (CLAUDE.md rule 13); the conflicts of every request together. */
export async function push(api: Api, mutations: Mutation[]): Promise<PushResponse> {
  const total: PushResponse = { applied: 0, skipped: 0, conflicts: [] };
  for (let i = 0; i < mutations.length; i += PUSH_MAX_MUTATIONS) {
    const res = await api.post<PushResponse>('/v1/sync/push', {
      device_id: webDeviceId(),
      mutations: mutations.slice(i, i + PUSH_MAX_MUTATIONS),
    });
    total.applied += res.applied;
    total.skipped += res.skipped;
    total.conflicts.push(...res.conflicts);
  }
  return total;
}
