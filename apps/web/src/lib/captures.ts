import { useSyncExternalStore } from 'react';
import { ApiError, type Api } from './api';
import { push, type Mutation } from './sync';

// Captures saved without network (T-310): the rows and the photo of a shelf price wait on this device, in IndexedDB,
// and go up in order when the network is back, the way Android's outbox does (04 §3).

export interface Capture {
  id: string;
  created_at: number;
  /** What it was, for messages: "Leche Lala 1 L en Soriana". */
  label: string;
  mutations: Mutation[];
  /** Files to upload once the rows are in, as `PUT` paths. */
  uploads: Array<{ path: string; blob: Blob }>;
}

export interface CaptureStore {
  all(): Promise<Capture[]>;
  add(capture: Capture): Promise<void>;
  remove(id: string): Promise<void>;
}

/** For tests and browsers without IndexedDB: they keep nothing across reloads. */
export function memoryStore(): CaptureStore {
  const items = new Map<string, Capture>();
  return {
    all: async () => [...items.values()].sort((a, b) => a.created_at - b.created_at),
    add: async (c) => void items.set(c.id, c),
    remove: async (id) => void items.delete(id),
  };
}

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

/** IndexedDB keeps Blobs, Safari included, so the photo waits with its rows. */
export function indexedDbStore(name = 'maunedas'): CaptureStore {
  let db: Promise<IDBDatabase> | null = null;
  const open = () => {
    db ??= new Promise((resolve, reject) => {
      const r = indexedDB.open(name, 1);
      r.onupgradeneeded = () => r.result.createObjectStore('captures', { keyPath: 'id' });
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    return db;
  };
  const store = async (mode: IDBTransactionMode) =>
    (await open()).transaction('captures', mode).objectStore('captures');
  return {
    all: async () =>
      ((await request((await store('readonly')).getAll())) as Capture[]).sort(
        (a, b) => a.created_at - b.created_at,
      ),
    add: async (c) => void (await request((await store('readwrite')).put(c))),
    remove: async (id) => void (await request((await store('readwrite')).delete(id))),
  };
}

let store: CaptureStore = typeof indexedDB === 'undefined' ? memoryStore() : indexedDbStore();
let pending = 0;
const listeners = new Set<() => void>();
const changed = async () => {
  pending = (await store.all()).length;
  listeners.forEach((listener) => listener());
};

/** Tests use their own store. */
export function setCaptureStore(next: CaptureStore) {
  store = next;
  pending = 0;
}

/** Keeps a capture until the network is back. */
export async function saveCapture(capture: Capture) {
  await store.add(capture);
  await changed();
}

/** How many captures wait, kept up to date. */
export function usePendingCaptures(): number {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      void changed();
      return () => listeners.delete(listener);
    },
    () => pending,
  );
}

export interface FlushResult {
  sent: number;
  /** Captures the API turned down; they are not tried again. */
  failed: Array<{ label: string; message: string }>;
}

let flushing: Promise<FlushResult> | null = null;

/**
 * Sends what waits, oldest first: its rows, then its files. Without network it stops and keeps the rest; a capture
 * the API turns down (or that conflicts) is dropped and reported. One flush at a time.
 */
export function flushCaptures(api: Api): Promise<FlushResult> {
  flushing ??= (async () => {
    const result: FlushResult = { sent: 0, failed: [] };
    try {
      for (const capture of await store.all()) {
        try {
          if (capture.mutations.length > 0) {
            const res = await push(api, capture.mutations);
            if (res.conflicts.length > 0) throw new Error('Alguien más cambió esos datos.');
          }
          for (const upload of capture.uploads) await api.put(upload.path, upload.blob);
          result.sent++;
        } catch (e) {
          if (e instanceof ApiError && e.status === 0) break;
          result.failed.push({ label: capture.label, message: e instanceof Error ? e.message : String(e) });
        }
        await store.remove(capture.id);
      }
    } finally {
      flushing = null;
      await changed();
    }
    return result;
  })();
  return flushing;
}
