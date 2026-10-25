import type { PromoType } from '@maunedas/shared/pricing/promotions';
import { useId } from 'react';
import { PROMO_TYPES } from '../../../lib/promotions';
import type { ParamKey } from './lineForm';

const FIELDS: Record<PromoType, Array<{ key: ParamKey; label: string; money?: boolean }>> = {
  price_cut: [{ key: 'to_cents', label: 'Precio con rebaja', money: true }],
  percent: [{ key: 'percent', label: 'Porcentaje de descuento' }],
  nxm: [
    { key: 'n', label: 'Llevas' },
    { key: 'm', label: 'Pagas' },
  ],
  nth_unit_discount: [
    { key: 'nth', label: 'Cada cuántas' },
    { key: 'percent', label: 'Porcentaje de descuento' },
  ],
  member_price: [{ key: 'member_cents', label: 'Precio de socio', money: true }],
  coupon: [{ key: 'amount_cents', label: 'Monto del descuento', money: true }],
  msi: [{ key: 'months', label: 'Meses' }],
  bundle: [{ key: 'amount_cents', label: 'Monto del descuento', money: true }],
  other: [{ key: 'amount_cents', label: 'Monto del descuento', money: true }],
};

/**
 * The promotion selector of S-05 (Android's `PromotionFields`): "Ninguna" or a type (09 §6.1), then the parameters
 * that type needs. The discount they give is computed by the caller.
 */
export function PromotionFields({
  type,
  params,
  onType,
  onParam,
}: {
  type: PromoType | null;
  params: Partial<Record<ParamKey, string>>;
  onType: (type: PromoType | null) => void;
  onParam: (key: ParamKey, text: string) => void;
}) {
  const id = useId();
  const options: Array<{ type: PromoType | null; label: string }> = [
    { type: null, label: 'Ninguna' },
    ...PROMO_TYPES,
  ];
  return (
    <div className="flex flex-col gap-2">
      <fieldset className="flex flex-wrap gap-2">
        <legend className="mb-1 text-label">Promoción</legend>
        {options.map((o) => (
          <label
            key={o.type ?? 'none'}
            className={`tab border border-outline/40 ${type === o.type ? 'tab-active' : ''}`}
          >
            <input
              type="radio"
              className="sr-only"
              name={`${id}-promo`}
              checked={type === o.type}
              onChange={() => onType(o.type)}
            />
            {o.label}
          </label>
        ))}
      </fieldset>
      {type && (
        <div className="flex flex-wrap gap-2">
          {FIELDS[type].map((f) => (
            <label key={f.key} className="flex flex-1 flex-col gap-1">
              <span className="text-label">{f.label}</span>
              <input
                inputMode="decimal"
                value={params[f.key] ?? ''}
                onChange={(e) => onParam(f.key, e.target.value)}
                className="field"
                placeholder={f.money ? '0.00' : undefined}
              />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
