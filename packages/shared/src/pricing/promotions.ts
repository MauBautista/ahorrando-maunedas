import { foldAccents } from '../text/fold';
import { roundHalfUp } from './rounding';

export type PromoType =
  | 'price_cut'
  | 'percent'
  | 'nxm'
  | 'nth_unit_discount'
  | 'member_price'
  | 'coupon'
  | 'msi'
  | 'bundle'
  | 'other';

/** `promotions.params` (esquema-d1.sql). Only the fields of the given type are used. */
export interface PromoParams {
  from_cents?: number;
  to_cents?: number;
  percent?: number;
  n?: number;
  m?: number;
  nth?: number;
  member_cents?: number;
  program?: string;
  code?: string;
  amount_cents?: number;
  months?: number;
  text?: string;
}

export interface PromoGuess {
  type: PromoType;
  params: PromoParams;
}

function required(params: PromoParams, key: keyof PromoParams, type: PromoType): number {
  const value = params[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RangeError(`La promoción ${type} requiere ${key}`);
  }
  return value;
}

/**
 * Line discount in cents for a promotion (SDD 09 §6.1), rounded half-up and bounded to [0, gross]
 * where gross = round(quantity × unitPriceCents).
 */
export function promotionDiscount(
  type: PromoType,
  params: PromoParams,
  quantity: number,
  unitPriceCents: number,
): number {
  const raw = rawDiscount(type, params, quantity, unitPriceCents);
  const gross = roundHalfUp(quantity * unitPriceCents);
  return Math.min(Math.max(roundHalfUp(raw), 0), gross);
}

function rawDiscount(type: PromoType, p: PromoParams, quantity: number, unitPriceCents: number): number {
  switch (type) {
    case 'price_cut':
      return (required(p, 'from_cents', type) - required(p, 'to_cents', type)) * quantity;
    case 'percent':
      return (unitPriceCents * quantity * required(p, 'percent', type)) / 100;
    case 'nxm': {
      const n = required(p, 'n', type);
      const m = required(p, 'm', type);
      return Math.floor(quantity / n) * (n - m) * unitPriceCents;
    }
    case 'nth_unit_discount':
      return (
        (Math.floor(quantity / required(p, 'nth', type)) * unitPriceCents * required(p, 'percent', type)) /
        100
      );
    case 'member_price':
      return (unitPriceCents - required(p, 'member_cents', type)) * quantity;
    case 'coupon':
      return p.amount_cents ?? (unitPriceCents * quantity * required(p, 'percent', type)) / 100;
    case 'msi':
      return 0;
    case 'bundle':
    case 'other':
      return p.amount_cents ?? 0;
  }
}

/** Interest-free months (MSI) are recorded but never change the price. */
export function affectsPrice(type: PromoType): boolean {
  return type !== 'msi';
}

const MSI_MONTHS = /(\d+)\s*(?:MSI|MESES SIN INTERESES)\b/;
const MSI_ANY = /\bMSI\b|MESES SIN INTERESES/;
const NXM = /\b([2-9])\s*X\s*([1-8])\b/;
const NTH_UNIT = /\b(?:2DA|SEGUNDA|2A)\b.*?(\d{1,3})\s*%/;
const MEMBER = /SOCIO|MEMBRESIA|MEMBER/;
const COUPON = /CUPON|COUPON/;
const PERCENT = /(\d{1,3})\s*%/;
const PRICE_CUT = /REBAJA|AHORRO|DESC|DESCUENTO|BAJA DE PRECIO/;

/**
 * Classifies the promotion text printed on a receipt (SDD 09 §6.2), checking the patterns in order.
 * Empty text → null; non-empty text without a known pattern → `other`. Whether the line actually had a
 * discount is decided by the caller.
 */
export function detectPromotion(text: string | null | undefined): PromoGuess | null {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim();
  if (clean === '') return null;
  const t = foldAccents(clean).toUpperCase();

  const months = MSI_MONTHS.exec(t);
  if (months) return { type: 'msi', params: { months: Number(months[1]) } };
  if (MSI_ANY.test(t)) return { type: 'msi', params: {} };

  const nxm = NXM.exec(t);
  if (nxm) {
    const n = Number(nxm[1]);
    const m = Number(nxm[2]);
    if (n > m) return { type: 'nxm', params: { n, m } };
  }

  const nth = NTH_UNIT.exec(t);
  if (nth) return { type: 'nth_unit_discount', params: { nth: 2, percent: Number(nth[1]) } };

  if (MEMBER.test(t)) return { type: 'member_price', params: {} };
  if (COUPON.test(t)) return { type: 'coupon', params: {} };

  const percent = PERCENT.exec(t);
  if (percent) return { type: 'percent', params: { percent: Number(percent[1]) } };

  if (PRICE_CUT.test(t)) return { type: 'price_cut', params: {} };
  return { type: 'other', params: { text: clean } };
}
