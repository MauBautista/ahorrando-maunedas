import type { ImageRef } from '@maunedas/shared/api/catalog';
import { useState } from 'react';

/**
 * A product's photo by the order of 10 §1 (lists: thumb → processed → original; big: processed → original), or its
 * initial without one or when it cannot load. The URLs are signed, so `<img>` needs no headers (06 §5).
 */
export function ProductPhoto({
  image,
  name,
  large = false,
  className = '',
}: {
  image: ImageRef | null;
  name: string;
  large?: boolean;
  className?: string;
}) {
  const url = image
    ? large
      ? (image.processed_url ?? image.original_url)
      : (image.thumb_url ?? image.processed_url ?? image.original_url)
    : null;
  const [failed, setFailed] = useState<string | null>(null);
  if (!url || failed === url) {
    return (
      <div
        aria-hidden
        className={`grid place-items-center rounded-lg bg-surface-variant text-title ${className}`}
      >
        {name.slice(0, 1).toUpperCase()}
      </div>
    );
  }
  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      onError={() => setFailed(url)}
      className={`rounded-lg bg-surface-variant object-cover ${className}`}
    />
  );
}
