import { useSyncExternalStore } from 'react';

const QUERY = '(min-width: 768px)';

function media(): MediaQueryList | null {
  return typeof window.matchMedia === 'function' ? window.matchMedia(QUERY) : null;
}

/** Whether the screen is `md` or wider: some screens change layout, not just size (06 §3, W-05). */
export function useWide(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const m = media();
      m?.addEventListener('change', onChange);
      return () => m?.removeEventListener('change', onChange);
    },
    () => media()?.matches ?? false,
  );
}
