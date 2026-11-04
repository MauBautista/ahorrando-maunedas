import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { flushCaptures, usePendingCaptures, type FlushResult } from '../lib/captures';
import { useApi } from '../lib/context';
import { formatTime } from '../lib/dates';
import { formatDate } from '../lib/format';
import { useOnline, useStoredAt } from '../lib/online';

/**
 * Under the header (T-310): says when the page works without network and how old what it shows is, how many captures
 * wait on this device, and sends them when the network is back (and when the app opens).
 */
export function OfflineBanner() {
  const api = useApi();
  const queryClient = useQueryClient();
  const online = useOnline();
  const storedAt = useStoredAt();
  const pending = usePendingCaptures();
  const [sent, setSent] = useState<FlushResult | null>(null);

  useEffect(() => {
    if (!online) return;
    let live = true;
    void flushCaptures(api).then((result) => {
      if (!live || (result.sent === 0 && result.failed.length === 0)) return;
      setSent(result);
      void queryClient.invalidateQueries();
    });
    return () => {
      live = false;
    };
  }, [api, online, queryClient]);

  const offline = !online || storedAt !== null;
  if (!offline && pending === 0 && !sent) return null;
  return (
    <div role="status" className="border-b border-outline/30 bg-surface-variant px-4 py-2 text-label">
      <div className="mx-auto flex max-w-5xl flex-col gap-1">
        {offline && (
          <p>
            Sin conexión: ves lo guardado en este dispositivo
            {storedAt !== null && ` (${formatDate(storedAt)}, ${formatTime(storedAt)})`}.
          </p>
        )}
        {pending > 0 && (
          <p>
            {pending === 1 ? '1 captura espera' : `${pending} capturas esperan`} la conexión para subirse.
          </p>
        )}
        {sent && sent.sent > 0 && (
          <p>
            {sent.sent === 1
              ? 'Se subió 1 captura guardada sin conexión.'
              : `Se subieron ${sent.sent} capturas guardadas sin conexión.`}
          </p>
        )}
        {sent?.failed.map((f) => (
          <p key={f.label} className="text-error">
            No se pudo subir {f.label}: {f.message}
          </p>
        ))}
      </div>
    </div>
  );
}
