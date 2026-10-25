import { useEffect, useRef, useState } from 'react';
import { ScanGate, scanCode } from '../lib/scan';
import { canScan, startScanner } from '../lib/scanner';
import { Dialog } from './Dialog';

function cameraProblem(e: unknown): string {
  const name = e instanceof DOMException || e instanceof Error ? e.name : '';
  if (name === 'NotAllowedError') return 'Permite el uso de la cámara en el navegador para escanear.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError')
    return 'No encontramos una cámara en este equipo.';
  return 'No se pudo abrir la cámara.';
}

/**
 * "Escanear código" (06 §3): the back camera in a modal until a code is confirmed (`ScanGate`, T64), then
 * [onCode] with its digits. Without a camera, or with it denied, the code can be typed.
 */
export function ScanDialog({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [problem, setProblem] = useState<string | null>(() =>
    canScan() ? null : 'Este navegador no puede abrir la cámara.',
  );
  const [typed, setTyped] = useState('');
  const [typedError, setTypedError] = useState<string | null>(null);
  const done = useRef(onCode);
  useEffect(() => {
    done.current = onCode;
  });

  useEffect(() => {
    if (!canScan() || !video.current) return;
    const gate = new ScanGate();
    let stop: (() => void) | null = null;
    let closed = false;
    startScanner(video.current, (text) => {
      const code = scanCode(text);
      if (!code || closed || !gate.accept(code, Date.now())) return;
      closed = true;
      stop?.();
      done.current(code);
    }).then(
      (s) => {
        if (closed) s();
        else stop = s;
      },
      (e: unknown) => {
        if (!closed) setProblem(cameraProblem(e));
      },
    );
    return () => {
      closed = true;
      stop?.();
    };
  }, []);

  function submitTyped() {
    const code = scanCode(typed);
    if (!code) return setTypedError('Un código tiene de 6 a 14 dígitos.');
    onCode(code);
  }

  return (
    <Dialog title="Escanear código" onClose={onClose}>
      <div className="flex flex-col gap-3">
        {problem ? (
          <p role="alert" className="text-error">
            {problem}
          </p>
        ) : (
          <video
            ref={video}
            muted
            playsInline
            aria-label="Cámara"
            className="aspect-[4/3] w-full rounded-lg bg-black object-cover"
          />
        )}
        <div className="flex items-end gap-2">
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-label">O escribe el código</span>
            <input
              inputMode="numeric"
              value={typed}
              onChange={(e) => {
                setTyped(e.target.value);
                setTypedError(null);
              }}
              onKeyDown={(e) => e.key === 'Enter' && submitTyped()}
              className="field"
            />
          </label>
          <button type="button" className="btn-outline" onClick={submitTyped}>
            Usar
          </button>
        </div>
        {typedError && (
          <p role="alert" className="text-error">
            {typedError}
          </p>
        )}
        <div className="flex justify-end">
          <button type="button" className="btn-outline" onClick={onClose}>
            Cancelar
          </button>
        </div>
      </div>
    </Dialog>
  );
}
