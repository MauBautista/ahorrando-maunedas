import { type ReactNode, useEffect, useId, useRef } from 'react';

/**
 * A modal over the page: a sheet from the bottom on a phone, centered from `md` up. Its heading takes the focus when
 * it opens, so a screen reader announces it; Escape closes it.
 */
export function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <div
      className="fixed inset-0 z-20 grid place-items-end bg-black/40 md:place-items-center"
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        className="max-h-dvh w-full overflow-y-auto rounded-t-xl bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:max-w-lg md:rounded-xl"
      >
        <h2 id={id} ref={heading} tabIndex={-1} className="mb-3 text-title outline-none">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}
