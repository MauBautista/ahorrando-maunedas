import { useState } from 'react';
import { Dialog } from '../../components/Dialog';

const KINDS = [
  { value: 'physical', label: 'Física' },
  { value: 'online', label: 'En línea' },
  { value: 'both', label: 'Ambas' },
] as const;

export type StoreKind = (typeof KINDS)[number]['value'];

/** "Nueva tienda" (S-14): its name and whether it is physical, online or both. */
export function NewStoreDialog({
  busy,
  onSave,
  onClose,
}: {
  busy: boolean;
  onSave: (name: string, kind: StoreKind) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<StoreKind>('physical');
  return (
    <Dialog title="Nueva tienda" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-label">Nombre de la tienda</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className="field" maxLength={200} />
        </label>
        <fieldset className="flex flex-wrap gap-2">
          <legend className="mb-1 text-label">Tipo</legend>
          {KINDS.map((k) => (
            <label
              key={k.value}
              className={`tab border border-outline/40 ${kind === k.value ? 'tab-active' : ''}`}
            >
              <input
                type="radio"
                className="sr-only"
                name="store-kind"
                checked={kind === k.value}
                onChange={() => setKind(k.value)}
              />
              {k.label}
            </label>
          ))}
        </fieldset>
        <Buttons
          busy={busy}
          disabled={!name.trim()}
          onSave={() => onSave(name.trim(), kind)}
          onClose={onClose}
        />
      </div>
    </Dialog>
  );
}

/** "Nueva sucursal" (S-14): its name and city (Puebla unless one was used before). */
export function NewBranchDialog({
  defaultCity,
  busy,
  onSave,
  onClose,
}: {
  defaultCity: string;
  busy: boolean;
  onSave: (name: string, city: string | null) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [city, setCity] = useState(defaultCity);
  return (
    <Dialog title="Nueva sucursal" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-label">Nombre de la sucursal</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className="field" maxLength={200} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-label">Ciudad</span>
          <input value={city} onChange={(e) => setCity(e.target.value)} className="field" maxLength={100} />
        </label>
        <Buttons
          busy={busy}
          disabled={!name.trim()}
          onSave={() => onSave(name.trim(), city.trim() || null)}
          onClose={onClose}
        />
      </div>
    </Dialog>
  );
}

function Buttons({
  busy,
  disabled,
  onSave,
  onClose,
}: {
  busy: boolean;
  disabled: boolean;
  onSave: () => void;
  onClose: () => void;
}) {
  return (
    <div className="flex justify-end gap-2">
      <button type="button" className="btn-outline" onClick={onClose}>
        Cancelar
      </button>
      <button type="button" className="btn-primary" disabled={busy || disabled} onClick={onSave}>
        Agregar
      </button>
    </div>
  );
}
