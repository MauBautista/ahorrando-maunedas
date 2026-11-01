import { useState } from 'react';
import { useVariantSearch } from '../purchases/editor/useVariantSearch';
import { subjectName } from './labels';
import type { ChosenVariant } from './presetVariant';

/** "Presentación": the chosen one with "Cambiar", or a search by name, brand or code to choose one. */
export function VariantPicker({
  value,
  onChange,
}: {
  value: ChosenVariant | null;
  onChange: (v: ChosenVariant | null) => void;
}) {
  const [query, setQuery] = useState('');
  const results = useVariantSearch(query, null);
  if (value)
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-outline/40 p-3">
        <span>{subjectName(value)}</span>
        <button type="button" className="btn-text" onClick={() => onChange(null)}>
          Cambiar
        </button>
      </div>
    );
  const items = results.data?.items ?? [];
  return (
    <div className="flex flex-col gap-2">
      <input
        type="search"
        aria-label="Buscar presentación"
        placeholder="Busca por nombre, marca o código"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="field"
      />
      {query.trim() !== '' && results.isSuccess && items.length === 0 && (
        <p className="text-label text-on-surface-variant">
          No hay presentaciones con ese nombre. Créala primero en el catálogo.
        </p>
      )}
      {items.length > 0 && (
        <ul aria-label="Presentaciones encontradas" className="flex max-h-60 flex-col overflow-y-auto">
          {items.map((i) => (
            <li key={i.variant_id}>
              <button
                type="button"
                className="w-full rounded-lg p-2 text-left hover:bg-surface-variant"
                onClick={() =>
                  onChange({
                    variant_id: i.variant_id,
                    product_id: i.product_id,
                    product_name: i.product_name,
                    variant_label: i.variant_label,
                  })
                }
              >
                {subjectName(i)}
                {i.brand && <span className="text-label text-on-surface-variant"> · {i.brand}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
