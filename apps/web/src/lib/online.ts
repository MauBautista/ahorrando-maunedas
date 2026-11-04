import { useSyncExternalStore } from 'react';

// Whether the page is working without network (T-310): the browser's own flag, and whether the last API answer came
// from the copy the service worker keeps on this device (a Wi-Fi without internet does not lower the flag).

// The service worker's names, repeated here on purpose: if the page imported them from src/sw/, the build would share
// a chunk between both and sw.js would need an import, which a classic service worker cannot do. A test keeps them
// equal.
/** The header of an API answer the service worker served from this device. */
export const STORED_AT_HEADER = 'X-Maunedas-Stored-At';
/** The caches that hold the session's data, cleared at sign-out. */
export const DATA_CACHE_NAMES = ['maunedas-api', 'maunedas-images'];

let storedAt: number | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

/** The API answered with what was stored on this device at [at] (epoch ms). */
export function servedFromDevice(at: number) {
  if (storedAt === at) return;
  storedAt = at;
  emit();
}

/** The API answered from the network again. */
export function servedFromNetwork() {
  if (storedAt === null) return;
  storedAt = null;
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('online', listener);
  window.addEventListener('offline', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('online', listener);
    window.removeEventListener('offline', listener);
  };
}

/** The browser says there is network. */
export const useOnline = () => useSyncExternalStore(subscribe, () => navigator.onLine);

/** When the data on screen was stored on this device, or null while the API answers from the network. */
export const useStoredAt = () => useSyncExternalStore(subscribe, () => storedAt);
