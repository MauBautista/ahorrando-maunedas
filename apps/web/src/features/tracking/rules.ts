import type { AlertType } from '@maunedas/shared/api/alerts';
import { parseAmount, parseCents } from '@maunedas/shared/text/decimal';
import type { ChosenVariant } from './presetVariant';

export const MAX_COOLDOWN = 720;

/** What the form checks before writing; the server checks the same (`AlertRuleRowSchema`). */
export function ruleProblem(f: {
  variant: ChosenVariant | null;
  type: AlertType;
  price: string;
  pct: string;
  cooldown: string;
}): string | null {
  if (!f.variant) return 'Elige la presentación.';
  if (f.type === 'below_price') {
    const cents = parseCents(f.price);
    if (cents === null || cents <= 0) return 'Escribe el precio objetivo, por ejemplo 25.50.';
  }
  if (f.type === 'drop_pct') {
    const pct = parseAmount(f.pct);
    if (pct === null || pct <= 0 || pct > 100) return 'El porcentaje va de 1 a 100.';
  }
  const hours = Number(f.cooldown);
  if (!/^\d+$/.test(f.cooldown.trim()) || hours > MAX_COOLDOWN)
    return `El silencio va de 0 a ${MAX_COOLDOWN} horas.`;
  return null;
}
