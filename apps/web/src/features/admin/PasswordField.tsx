import { useState } from 'react';
import { generatePassword } from '../../lib/password';

/**
 * A password the admin types or generates; visible, since it is handed over in person (W-11). "Copiar" uses the
 * clipboard when the browser allows it.
 */
export function PasswordField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-end gap-2">
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-label">{label}</span>
          <input
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
              setCopied(false);
            }}
            autoComplete="new-password"
            spellCheck={false}
            className="field font-mono"
          />
        </label>
        <button
          type="button"
          className="btn-outline"
          onClick={() => {
            onChange(generatePassword());
            setCopied(false);
          }}
        >
          Generar
        </button>
        <button
          type="button"
          className="btn-outline"
          disabled={!value || !navigator.clipboard}
          onClick={() => void navigator.clipboard?.writeText(value).then(() => setCopied(true))}
        >
          Copiar
        </button>
      </div>
      <span className="text-label text-on-surface-variant" role={copied ? 'status' : undefined}>
        {copied ? 'Copiada.' : 'Al menos 8 caracteres. Compártela en persona; no se vuelve a mostrar.'}
      </span>
    </div>
  );
}
