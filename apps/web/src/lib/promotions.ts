import type { PromoParams, PromoType } from '@maunedas/shared/pricing/promotions';
import { formatMoney } from './format';

/** The promotion types in the order of the selector (S-05, S-13), with Android's names (`PromoType.label`). */
export const PROMO_TYPES: ReadonlyArray<{ type: PromoType; label: string }> = [
  { type: 'price_cut', label: 'Rebaja' },
  { type: 'percent', label: 'Porcentaje' },
  { type: 'nxm', label: '2x1, 3x2…' },
  { type: 'nth_unit_discount', label: 'N-ésima con descuento' },
  { type: 'member_price', label: 'Precio de socio' },
  { type: 'coupon', label: 'Cupón' },
  { type: 'msi', label: 'Meses sin intereses' },
  { type: 'bundle', label: 'Paquete' },
  { type: 'other', label: 'Otra' },
];

export function promoLabel(type: PromoType): string {
  return PROMO_TYPES.find((p) => p.type === type)!.label;
}

const number = (v: number) => String(v);
const money = (v: number | undefined) => (v === undefined ? undefined : formatMoney(v));

/** How a promotion reads ("2x1", "15 % de descuento"…), Android's `promotionText`; the type's name when a parameter is missing. */
export function promotionText(type: PromoType, p: PromoParams): string {
  const text = ((): string | undefined => {
    switch (type) {
      case 'price_cut':
        return p.to_cents === undefined ? undefined : `Rebaja a ${money(p.to_cents)}`;
      case 'percent':
        return p.percent === undefined ? undefined : `${number(p.percent)} % de descuento`;
      case 'nxm':
        return p.n === undefined || p.m === undefined ? undefined : `${number(p.n)}x${number(p.m)}`;
      case 'nth_unit_discount':
        return p.nth === undefined || p.percent === undefined
          ? undefined
          : `La ${number(p.nth)}.ª con ${number(p.percent)} % de descuento`;
      case 'member_price':
        return p.member_cents === undefined ? undefined : `Precio de socio ${money(p.member_cents)}`;
      case 'coupon':
        return p.amount_cents === undefined ? undefined : `Cupón de ${money(p.amount_cents)}`;
      case 'msi':
        return p.months === undefined ? undefined : `${number(p.months)} meses sin intereses`;
      case 'bundle':
        return p.amount_cents === undefined ? undefined : `Paquete con ${money(p.amount_cents)} de descuento`;
      case 'other':
        return p.amount_cents === undefined ? undefined : `Promoción de ${money(p.amount_cents)}`;
    }
  })();
  return text ?? promoLabel(type);
}

const KEYS: ReadonlyArray<keyof PromoParams> = [
  'from_cents',
  'to_cents',
  'percent',
  'n',
  'm',
  'nth',
  'member_cents',
  'program',
  'code',
  'amount_cents',
  'months',
  'text',
];

/** `promotions.params` as Android's `PromoParamsJson`: only the fields that are set, or null without any. */
export function encodeParams(p: PromoParams): string | null {
  const fields = KEYS.filter((k) => p[k] !== undefined).map((k) => [k, p[k]]);
  return fields.length ? JSON.stringify(Object.fromEntries(fields)) : null;
}

export function decodeParams(json: string | null): PromoParams {
  if (!json) return {};
  try {
    const o = JSON.parse(json) as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of KEYS) {
      const v = o[k];
      const text = k === 'program' || k === 'code' || k === 'text';
      if (text ? typeof v === 'string' : typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    }
    return out as PromoParams;
  } catch {
    return {};
  }
}
