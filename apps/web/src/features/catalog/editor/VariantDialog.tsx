import type { ProductDetailVariant } from '@maunedas/shared/api/catalog';
import { useEffect, useRef, useState } from 'react';
import { useCodeCheck } from './useCodeCheck';
import { VariantFields } from './VariantFields';
import { emptyVariant, type VariantDraft, variantFormOf, validateVariant } from './variantForm';

/** S-10 over the product editor: a new variant or one to edit; an admin can also delete it (RF-CAT-08). */
export function VariantDialog({
  variant,
  isAdmin,
  busy,
  error,
  onSave,
  onDelete,
  onClose,
}: {
  variant: ProductDetailVariant | null;
  isAdmin: boolean;
  busy: boolean;
  error: string | null;
  onSave: (draft: VariantDraft) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState(() => (variant ? variantFormOf(variant) : emptyVariant()));
  const checkCode = useCodeCheck();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  function save() {
    const { draft, form: checked } = validateVariant(form);
    setForm(checked);
    if (draft) onSave(draft);
  }
  return (
    <div
      className="fixed inset-0 z-20 grid place-items-end bg-black/40 md:place-items-center"
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="variant-title"
        className="max-h-dvh w-full overflow-y-auto rounded-t-xl bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:max-w-lg md:rounded-xl"
      >
        <h2 id="variant-title" ref={heading} tabIndex={-1} className="mb-3 text-title outline-none">
          {variant ? 'Editar presentación' : 'Nueva presentación'}
        </h2>
        <VariantFields
          form={form}
          onChange={(change) => setForm(change)}
          onAddCode={async () => setForm(await checkCode(form))}
        />
        {error && (
          <p role="alert" className="mt-3 text-error">
            {error}
          </p>
        )}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {variant && isAdmin && (
            <button type="button" className="btn-text mr-auto text-error" disabled={busy} onClick={onDelete}>
              Eliminar presentación
            </button>
          )}
          <button type="button" className="btn-outline" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="btn-primary" disabled={busy} onClick={save}>
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}
