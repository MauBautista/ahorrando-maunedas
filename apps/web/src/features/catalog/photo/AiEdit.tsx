import { type AiEditQuote, type AiEditResponse, DEFAULT_AI_EDIT_PROMPT } from '@maunedas/shared/api/images';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError } from '../../../lib/api';
import { useApi } from '../../../lib/context';
import { formatDollars } from '../../../lib/format';

type Step = 'closed' | 'confirm' | 'working' | 'result';

function problemOf(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'AI_BUDGET_EXCEEDED') return 'Se alcanzó el tope de gasto en IA de este mes.';
    if (e.code === 'AI_UNAVAILABLE') return 'La IA no respondió. Intenta más tarde.';
    if (e.code === 'UPSTREAM_ERROR') return 'La IA no devolvió una foto que se pueda usar. Intenta de nuevo.';
  }
  return e instanceof Error ? e.message : 'No se pudo editar la foto.';
}

/**
 * "Mejorar con IA" in the photo editor (10 §6.3, T-302): it says what it would cost and what was spent this month,
 * asks before spending, and shows the result to use or discard. Nothing shows while no model is chosen.
 */
export function AiEdit({
  imageId,
  onUse,
  busy,
}: {
  imageId: string;
  /** Adopts the AI's rendition, whose image is at [url]. */
  onUse: (renditionId: string, url: string) => void;
  busy: boolean;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const quote = useQuery({
    queryKey: ['ai-edit-quote'],
    queryFn: () => api.get<AiEditQuote>('/v1/ai/image-edit'),
  });
  const [step, setStep] = useState<Step>('closed');
  const [prompt, setPrompt] = useState('');
  const [result, setResult] = useState<AiEditResponse | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const q = quote.data;
  if (!q || q.reason === 'NOT_CONFIGURED') return null;

  async function run() {
    setStep('working');
    setProblem(null);
    try {
      const body = prompt.trim() ? { prompt: prompt.trim(), confirm: true } : { confirm: true };
      setResult(await api.post<AiEditResponse>(`/v1/images/${imageId}/ai-edit`, body));
      setStep('result');
    } catch (e) {
      setProblem(problemOf(e));
      setStep('confirm');
    } finally {
      await queryClient.invalidateQueries({ queryKey: ['ai-edit-quote'] });
    }
  }

  const spending = `Costo estimado: ${formatDollars(q.estimate_usd)}. Gastado este mes: ${formatDollars(q.spent_usd)} de ${formatDollars(q.budget_usd)}.`;

  return (
    <section
      aria-label="Mejorar con IA"
      className="flex flex-col gap-2 rounded-lg border border-outline/30 p-3"
    >
      {step === 'closed' && (
        <div className="flex flex-col gap-1">
          <button
            type="button"
            className="btn-outline self-start"
            disabled={!q.available || busy}
            onClick={() => setStep('confirm')}
          >
            Mejorar con IA
          </button>
          {q.reason === 'BUDGET' && (
            <p className="text-label text-on-surface-variant">
              Se alcanzó el tope de gasto en IA de este mes.
            </p>
          )}
        </div>
      )}
      {(step === 'confirm' || step === 'working') && (
        <>
          <label className="flex flex-col gap-1 text-label">
            Qué pedirle (opcional)
            <textarea
              className="field min-h-24 py-2"
              maxLength={1000}
              placeholder={DEFAULT_AI_EDIT_PROMPT}
              value={prompt}
              disabled={step === 'working'}
              onChange={(e) => setPrompt(e.target.value)}
            />
          </label>
          <p className="text-label text-on-surface-variant">{spending}</p>
          {problem && (
            <p role="alert" className="text-error">
              {problem}
            </p>
          )}
          {step === 'working' ? (
            <p role="status">La IA está editando la foto; puede tardar un minuto…</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-primary" disabled={!q.available} onClick={run}>
                Confirmar y gastar
              </button>
              <button type="button" className="btn-text" onClick={() => setStep('closed')}>
                Cancelar
              </button>
            </div>
          )}
        </>
      )}
      {step === 'result' && result && (
        <>
          <img
            src={result.url}
            alt="Foto editada por la IA"
            className="max-h-80 self-start rounded-lg bg-white"
          />
          <p className="text-label text-on-surface-variant">Costó {formatDollars(result.cost_usd)}.</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-primary"
              disabled={busy}
              onClick={() => onUse(result.rendition_id, result.url)}
            >
              Usar esta foto
            </button>
            <button
              type="button"
              className="btn-text"
              disabled={busy}
              onClick={() => {
                setResult(null);
                setStep('closed');
              }}
            >
              Descartar
            </button>
          </div>
        </>
      )}
    </section>
  );
}
