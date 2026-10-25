import { type ContentUnit, contentUnitsOf } from '@maunedas/shared/catalog/content';
import type { Measure } from '@maunedas/shared/pricing/units';
import { useId, useState } from 'react';
import {
  type VariantForm,
  suggestedLabel,
  withAmount,
  withBulk,
  withLabel,
  withMeasure,
  withPack,
  withUnit,
  withoutCode,
} from './variantForm';

const MEASURES: Array<{ value: Measure; label: string }> = [
  { value: 'mass', label: 'Masa' },
  { value: 'volume', label: 'Volumen' },
  { value: 'count', label: 'Piezas' },
];

/** S-10 in the web: measure, content (or "a granel"), label and codes. [onAddCode] checks a typed code and adds it. */
export function VariantFields({
  form,
  onChange,
  onAddCode,
}: {
  form: VariantForm;
  onChange: (change: (f: VariantForm) => VariantForm) => void;
  onAddCode: () => Promise<void>;
}) {
  const id = useId();
  const [checking, setChecking] = useState(false);
  const field = (name: string) => `${id}-${name}`;
  async function addCode() {
    setChecking(true);
    try {
      await onAddCode();
    } finally {
      setChecking(false);
    }
  }
  return (
    <div className="flex flex-col gap-3">
      <fieldset className="flex flex-wrap gap-2">
        <legend className="mb-1 text-label">Medida</legend>
        {MEASURES.map((m) => (
          <label
            key={m.value}
            className={`tab border border-outline/40 ${form.measure === m.value ? 'tab-active' : ''}`}
          >
            <input
              type="radio"
              className="sr-only"
              name={field('measure')}
              checked={form.measure === m.value}
              onChange={() => onChange((f) => withMeasure(f, m.value))}
            />
            {m.label}
          </label>
        ))}
      </fieldset>
      {form.measure === 'mass' && (
        <label className="inline-flex min-h-12 items-center gap-2">
          <input
            type="checkbox"
            checked={form.bulk}
            onChange={(e) => onChange((f) => withBulk(f, e.target.checked))}
          />
          Se vende a granel (por kilo)
        </label>
      )}
      {!form.bulk && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex w-28 flex-col gap-1">
            <span className="text-label">Unidades en el paquete</span>
            <input
              inputMode="numeric"
              value={form.pack}
              onChange={(e) => onChange((f) => withPack(f, e.target.value))}
              className="field"
              aria-invalid={!!form.packError}
            />
          </label>
          <span className="pb-3">×</span>
          <label className="flex w-32 flex-col gap-1">
            <span className="text-label">Contenido</span>
            <input
              inputMode="decimal"
              value={form.amount}
              onChange={(e) => onChange((f) => withAmount(f, e.target.value))}
              className="field"
              aria-invalid={!!form.amountError}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-label">Unidad</span>
            <select
              value={form.unit}
              onChange={(e) => onChange((f) => withUnit(f, e.target.value as ContentUnit))}
              className="field"
            >
              {contentUnitsOf(form.measure).map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {[form.packError, form.amountError].filter(Boolean).map((e) => (
        <p key={e} role="alert" className="text-error">
          {e}
        </p>
      ))}
      <label className="flex flex-col gap-1">
        <span className="text-label">Etiqueta</span>
        <input
          value={form.label}
          placeholder={suggestedLabel(form) ?? ''}
          onChange={(e) => onChange((f) => withLabel(f, e.target.value))}
          className="field"
          aria-invalid={!!form.labelError}
        />
      </label>
      {form.labelError && (
        <p role="alert" className="text-error">
          {form.labelError}
        </p>
      )}
      <div className="flex flex-col gap-2">
        <span className="text-label">Códigos de barras</span>
        {form.codes.length > 0 && (
          <ul className="flex flex-wrap gap-2" aria-label="Códigos">
            {form.codes.map((c) => (
              <li key={c} className="inline-flex items-center gap-1 rounded-sm bg-surface-variant pl-2">
                {c}
                <button
                  type="button"
                  className="btn-text min-h-10 px-2"
                  aria-label={`Quitar ${c}`}
                  onClick={() => onChange((f) => withoutCode(f, c))}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <input
            aria-label="Nuevo código"
            inputMode="numeric"
            value={form.codeInput}
            onChange={(e) => onChange((f) => ({ ...f, codeInput: e.target.value, codeError: null }))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void addCode();
              }
            }}
            className="field flex-1"
          />
          <button
            type="button"
            className="btn-outline"
            disabled={checking || !form.codeInput.trim()}
            onClick={() => void addCode()}
          >
            Agregar código
          </button>
        </div>
        {form.codeError && (
          <p role="alert" className="text-error">
            {form.codeError}
          </p>
        )}
      </div>
    </div>
  );
}
