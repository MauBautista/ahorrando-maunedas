import type { AlertRuleItem, AlertScope, AlertType } from '@maunedas/shared/api/alerts';
import { parseAmount, parseCents, plainCents } from '@maunedas/shared/text/decimal';
import { useState } from 'react';
import { Dialog } from '../../components/Dialog';
import { useApi } from '../../lib/context';
import { newRow, push, touchedAt } from '../../lib/sync';
import { conflictMessage } from '../catalog/editor/conflicts';
import { RULE_TYPES, SCOPES, subjectName } from './labels';
import { useListings } from './queries';
import type { ChosenVariant } from './presetVariant';
import { ruleProblem } from './rules';
import { VariantPicker } from './VariantPicker';

/**
 * S-22: a rule's type, threshold, scope (for `new_low`), one link or any, silence in hours and whether it is active.
 * The variant of a saved rule does not change: a rule for another one is a new rule.
 */
export function RuleDialog({
  rule,
  preset,
  userId,
  onSaved,
  onClose,
}: {
  rule: AlertRuleItem | null;
  preset: ChosenVariant | null;
  userId: string;
  onSaved: () => void;
  onClose: () => void;
}) {
  const api = useApi();
  const [variant, setVariant] = useState<ChosenVariant | null>(rule ?? preset);
  const [type, setType] = useState<AlertType>(rule?.type ?? 'below_price');
  const [price, setPrice] = useState(rule?.threshold_cents ? plainCents(rule.threshold_cents) : '');
  const [pct, setPct] = useState(rule?.threshold_pct ? String(rule.threshold_pct) : '10');
  const [scope, setScope] = useState<AlertScope>(rule?.scope ?? 'variant_web');
  const [listingId, setListingId] = useState(rule?.listing_id ?? '');
  const [cooldown, setCooldown] = useState(String(rule?.cooldown_hours ?? 24));
  const [active, setActive] = useState(rule ? rule.active === 1 : true);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const listings = useListings(variant?.variant_id ?? null, !!variant);

  async function save() {
    const invalid = ruleProblem({ variant, type, price, pct, cooldown });
    if (invalid) return setProblem(invalid);
    setBusy(true);
    setProblem(null);
    try {
      const fields = {
        user_id: userId,
        variant_id: variant!.variant_id,
        listing_id: listingId || null,
        type,
        threshold_cents: type === 'below_price' ? parseCents(price) : null,
        threshold_pct: type === 'drop_pct' ? parseAmount(pct) : null,
        scope: type === 'new_low' ? scope : 'variant_web',
        cooldown_hours: Number(cooldown),
        active: active ? 1 : 0,
      };
      const row = rule ? { id: rule.id, updated_at: touchedAt(rule.updated_at), ...fields } : newRow(fields);
      const message = conflictMessage((await push(api, [{ table: 'alert_rules', row }])).conflicts);
      if (message) return setProblem(message);
      onSaved();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title={rule ? 'Editar alerta' : 'Nueva alerta'} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-label">Presentación</span>
          {rule ? (
            <p className="rounded-lg border border-outline/40 p-3">{subjectName(rule)}</p>
          ) : (
            <VariantPicker
              value={variant}
              onChange={(v) => {
                setVariant(v);
                setListingId('');
              }}
            />
          )}
        </div>
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-label">Avisarme cuando…</legend>
          {RULE_TYPES.map((t) => (
            <label key={t.value} className="flex items-center gap-2">
              <input
                type="radio"
                name="rule-type"
                checked={type === t.value}
                onChange={() => setType(t.value)}
              />
              {t.label}
            </label>
          ))}
        </fieldset>
        {type === 'below_price' && (
          <label className="flex flex-col gap-1">
            <span className="text-label">Precio objetivo (MXN)</span>
            <input
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="field"
              placeholder="25.50"
            />
          </label>
        )}
        {type === 'drop_pct' && (
          <label className="flex flex-col gap-1">
            <span className="text-label">Porcentaje de baja</span>
            <input
              inputMode="decimal"
              value={pct}
              onChange={(e) => setPct(e.target.value)}
              className="field"
            />
          </label>
        )}
        {type === 'new_low' && (
          <label className="flex flex-col gap-1">
            <span className="text-label">Comparar</span>
            <select value={scope} onChange={(e) => setScope(e.target.value as AlertScope)} className="field">
              {SCOPES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1">
          <span className="text-label">Tienda</span>
          <select
            value={listingId}
            onChange={(e) => setListingId(e.target.value)}
            className="field"
            disabled={!variant}
          >
            <option value="">Cualquier enlace que siga esta presentación</option>
            {(listings.data?.items ?? []).map((l) => (
              <option key={l.id} value={l.id}>
                Solo {l.store_name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-label">Silencio después de avisar (horas)</span>
          <input
            inputMode="numeric"
            value={cooldown}
            onChange={(e) => setCooldown(e.target.value)}
            className="field"
          />
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Activa
        </label>
        {problem && (
          <p role="alert" className="text-error">
            {problem}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-text" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="btn-primary" disabled={busy} onClick={save}>
            {busy ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
