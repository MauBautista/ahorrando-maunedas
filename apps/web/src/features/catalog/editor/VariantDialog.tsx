import type { ProductDetailVariant } from '@maunedas/shared/api/catalog';
import { useState } from 'react';
import { Dialog } from '../../../components/Dialog';
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
  function save() {
    const { draft, form: checked } = validateVariant(form);
    setForm(checked);
    if (draft) onSave(draft);
  }
  return (
    <Dialog title={variant ? 'Editar presentación' : 'Nueva presentación'} onClose={onClose}>
      <VariantFields
        form={form}
        onChange={(change) => setForm(change)}
        onAddCode={async (scanned) =>
          setForm(await checkCode(scanned === undefined ? form : { ...form, codeInput: scanned }))
        }
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
    </Dialog>
  );
}
