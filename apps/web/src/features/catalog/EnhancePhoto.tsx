import type { ImageRef } from '@maunedas/shared/api/catalog';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../../lib/api';
import { useApi } from '../../lib/context';
import { push, touchedAt } from '../../lib/sync';

/**
 * "Mejorar en casa" for the product's photo (10 §6.1, T-300). The request goes to the Worker and
 * `enhance_requested_at` by sync. Once the home server's result arrives it is adopted here, by sync too: the photo
 * selects the newest `home` renditions unless it was edited by hand, the same choice any phone makes.
 */
export function EnhancePhoto({ productId, image }: { productId: string; image: ImageRef | null }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [asked, setAsked] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Each result is adopted once, even if the page reloads before the write comes back.
  const adopted = useRef<string | null>(null);

  useEffect(() => {
    const adopt = image?.adopt;
    if (!image || !adopt) return;
    const key = `${image.image_id}:${adopt.processed_id}:${adopt.thumb_id}`;
    if (adopted.current === key) return;
    adopted.current = key;
    push(api, [
      {
        table: 'images',
        row: {
          id: image.image_id,
          updated_at: touchedAt(image.updated_at),
          selected_processed_id: adopt.processed_id,
          selected_thumb_id: adopt.thumb_id,
        },
      },
    ])
      .then(() => queryClient.invalidateQueries({ queryKey: ['product', productId] }))
      .catch(() => {
        adopted.current = null;
      });
  }, [api, image, productId, queryClient]);

  if (!image) return null;

  async function enhance() {
    if (!image) return;
    setBusy(true);
    setProblem(null);
    try {
      await api.post(`/v1/images/${image.image_id}/enhance`);
      const now = Date.now();
      await push(api, [
        {
          table: 'images',
          row: {
            id: image.image_id,
            updated_at: touchedAt(image.updated_at, now),
            enhance_requested_at: now,
          },
        },
      ]);
      setAsked(true);
      await queryClient.invalidateQueries({ queryKey: ['product', productId] });
    } catch (e) {
      setProblem(
        e instanceof ApiError && e.code === 'IMAGE_NOT_UPLOADED'
          ? 'La foto todavía se está subiendo; intenta en un momento.'
          : e instanceof Error
            ? e.message
            : 'No se pudo pedir la mejora.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (image.enhance_pending || asked) {
    return (
      <p role="status" className="text-label text-on-surface-variant">
        Mejora pedida: el servidor casero quitará el fondo en unos minutos.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <button type="button" className="btn-outline self-start" disabled={busy} onClick={enhance}>
        Mejorar en casa
      </button>
      {problem && (
        <p role="alert" className="text-error">
          {problem}
        </p>
      )}
    </div>
  );
}
