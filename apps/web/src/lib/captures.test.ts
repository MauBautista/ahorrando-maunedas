import { afterEach, describe, expect, it } from 'vitest';
import { ApiError, type Api } from './api';
import { type Capture, flushCaptures, memoryStore, saveCapture, setCaptureStore } from './captures';

/** An API that answers each write by [answer], keeping what it was sent. */
function fakeApi(
  answer: (method: string, path: string) => unknown = () => ({ applied: 1, skipped: 0, conflicts: [] }),
) {
  const sent: string[] = [];
  const write = async (method: string, path: string) => {
    sent.push(`${method} ${path}`);
    const result = answer(method, path);
    if (result instanceof Error) throw result;
    return result;
  };
  const api = {
    get: async () => ({}),
    post: (path: string) => write('POST', path),
    put: (path: string) => write('PUT', path),
    patch: (path: string) => write('PATCH', path),
    del: (path: string) => write('DELETE', path),
  } as unknown as Api;
  return { api, sent };
}

const capture = (id: string, at: number, uploads = 0): Capture => ({
  id,
  created_at: at,
  label: `captura ${id}`,
  mutations: [{ table: 'price_observations', row: { id: `o-${id}` } }],
  uploads: Array.from({ length: uploads }, (_, i) => ({
    path: `/v1/images/${id}/blobs/${i}.jpg`,
    blob: new Blob(['x']),
  })),
});

afterEach(() => setCaptureStore(memoryStore()));

describe('captures waiting for the network (T-310)', () => {
  it('go up oldest first, rows before their photo, and leave the device', async () => {
    const store = memoryStore();
    setCaptureStore(store);
    await saveCapture(capture('b', 2, 1));
    await saveCapture(capture('a', 1));
    const { api, sent } = fakeApi();
    expect(await flushCaptures(api)).toEqual({ sent: 2, failed: [] });
    expect(sent).toEqual(['POST /v1/sync/push', 'POST /v1/sync/push', 'PUT /v1/images/b/blobs/0.jpg']);
    expect(await store.all()).toEqual([]);
    // A capture of only a photo has no rows to push.
    await saveCapture({ ...capture('c', 3, 1), mutations: [] });
    const photo = fakeApi();
    await flushCaptures(photo.api);
    expect(photo.sent).toEqual(['PUT /v1/images/c/blobs/0.jpg']);
  });

  it('without network they stop and wait; what the API turns down is dropped and said', async () => {
    const store = memoryStore();
    setCaptureStore(store);
    for (const [id, at] of [
      ['a', 1],
      ['b', 2],
      ['c', 3],
    ] as const)
      await saveCapture(capture(id, at, 1));
    let calls = 0;
    const { api } = fakeApi(() => {
      calls++;
      if (calls === 1) return new ApiError(422, 'VALIDATION_ERROR', 'Datos inválidos.');
      if (calls === 2) return { applied: 1, skipped: 0, conflicts: [] };
      return new ApiError(0, 'NETWORK', 'Sin conexión.');
    });
    expect(await flushCaptures(api)).toEqual({
      sent: 0,
      failed: [{ label: 'captura a', message: 'Datos inválidos.' }],
    });
    // "b" pushed its rows but its photo met no network: it waits whole, with "c", which is not even tried.
    expect((await store.all()).map((c) => c.id)).toEqual(['b', 'c']);
    expect(calls).toBe(3);
  });

  it('a conflict is a failure, and one flush runs at a time', async () => {
    setCaptureStore(memoryStore());
    await saveCapture(capture('a', 1));
    const { api, sent } = fakeApi(() => ({
      applied: 0,
      skipped: 0,
      conflicts: [{ id: 'o-a', reason: 'STALE' }],
    }));
    const [first, second] = await Promise.all([flushCaptures(api), flushCaptures(api)]);
    expect(first).toBe(second);
    expect(first!.failed).toEqual([{ label: 'captura a', message: 'Alguien más cambió esos datos.' }]);
    expect(sent).toHaveLength(1);
  });
});
