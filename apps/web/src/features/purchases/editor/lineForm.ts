import type { VariantSearchItem } from '@maunedas/shared/api/catalog';
import { type PromoParams, type PromoType, promotionDiscount } from '@maunedas/shared/pricing/promotions';
import { parseAmount, parseCents, plainCents } from '@maunedas/shared/text/decimal';
import {
  type LinePromotion,
  type LineVariant,
  type PurchaseLine,
  quantityText,
  variantOfSearch,
} from './draft';

/** The promotion parameters that are money; the rest are plain numbers (n, m, percent, months). */
const MONEY_PARAMS = new Set<keyof PromoParams>(['to_cents', 'member_cents', 'amount_cents']);
export type ParamKey =
  'to_cents' | 'percent' | 'n' | 'm' | 'nth' | 'member_cents' | 'amount_cents' | 'months';

/**
 * S-05 as typed, Android's `LineForm`. The numbers are kept as written so a half-typed price is not lost; the
 * promotion's discount is `promotionDiscount` of its parameters, and typing a discount by hand replaces it and saves
 * the line as `other` with that amount (05 §5).
 */
export interface LineForm {
  lineId: string | null;
  variant: LineVariant | null;
  rawText: string | null;
  quantity: string;
  price: string;
  promoType: PromoType | null;
  params: Partial<Record<ParamKey, string>>;
  /** "Ajustar el descuento a mano"; null while not adjusting. */
  manualDiscount: string | null;
  error: string | null;
}

export function newLineForm(): LineForm {
  return {
    lineId: null,
    variant: null,
    rawText: null,
    quantity: '1',
    price: '',
    promoType: null,
    params: {},
    manualDiscount: null,
    error: null,
  };
}

const PARAM_KEYS: readonly ParamKey[] = [
  'to_cents',
  'percent',
  'n',
  'm',
  'nth',
  'member_cents',
  'amount_cents',
  'months',
];

/** The typed parameters of a saved promotion; `from_cents` of a price cut is the list price, not typed. */
function paramTexts(p: PromoParams): Partial<Record<ParamKey, string>> {
  const out: Partial<Record<ParamKey, string>> = {};
  for (const k of PARAM_KEYS) {
    const v = p[k];
    if (typeof v === 'number') out[k] = MONEY_PARAMS.has(k) ? plainCents(v) : String(v);
  }
  return out;
}

export function lineFormOf(line: PurchaseLine): LineForm {
  const promo = line.promotion;
  return {
    lineId: line.id,
    variant: line.variant,
    rawText: line.rawText,
    quantity: quantityText(line.quantity),
    price: plainCents(line.unitPriceCents),
    promoType: promo?.type ?? null,
    params: promo ? paramTexts(promo.params) : {},
    // A saved `other` comes back as typed by hand.
    manualDiscount: promo?.type === 'other' ? plainCents(promo.discountCents) : null,
    error: null,
  };
}

/** A variant picked from the search: bulk is weighed; anything else starts at one piece, at the store's last price. */
export function withVariant(f: LineForm, choice: VariantSearchItem): LineForm {
  const variant = variantOfSearch(choice);
  const q = parseAmount(f.quantity);
  return {
    ...f,
    variant,
    quantity: variant.soldByWeight ? '' : q !== null && Number.isInteger(q) ? f.quantity : '1',
    price: f.price || (choice.last_unit_cents === null ? '' : plainCents(choice.last_unit_cents)),
    error: null,
  };
}

/** The stepper: whole pieces, at least one. */
export function step(f: LineForm, delta: number): LineForm {
  const q = parseAmount(f.quantity) ?? 0;
  return { ...f, quantity: String(Math.max(1, Math.floor(q) + delta)), error: null };
}

export function withPromo(f: LineForm, type: PromoType | null): LineForm {
  return { ...f, promoType: type, params: {}, manualDiscount: null, error: null };
}

function number(text: string | undefined): number | undefined {
  if (text === undefined) return undefined;
  const v = Number(text.trim().replace(',', '.'));
  return text.trim() !== '' && Number.isFinite(v) && v >= 0 ? v : undefined;
}

/** The parameters as numbers; `price_cut` starts from the list price. */
function effectiveParams(f: LineForm): PromoParams {
  const p: PromoParams = {};
  for (const [k, text] of Object.entries(f.params) as Array<[ParamKey, string]>) {
    const v = MONEY_PARAMS.has(k) ? (parseCents(text) ?? undefined) : number(text);
    if (v !== undefined) p[k] = v;
  }
  if (f.promoType === 'price_cut') {
    const price = parseCents(f.price);
    if (price !== null) p.from_cents = price;
  }
  return p;
}

/** The promotion's discount, or null while its parameters are incomplete (`promotionDiscount` throws then). */
export function computedDiscount(f: LineForm): number | null {
  const q = parseAmount(f.quantity);
  const price = parseCents(f.price);
  if (!f.promoType || q === null || price === null) return null;
  try {
    return promotionDiscount(f.promoType, effectiveParams(f), q, price);
  } catch {
    return null;
  }
}

/** The discount typed by hand: undefined while not adjusting (or left empty), null when it is not an amount. */
function manualCents(f: LineForm): number | null | undefined {
  if (f.manualDiscount === null || f.manualDiscount.trim() === '') return undefined;
  return parseCents(f.manualDiscount);
}

/** The promotion as it will be saved: typed by hand → `other` with that amount. */
function promotion(f: LineForm, id: string | null): LinePromotion | null {
  if (!f.promoType) return null;
  const manual = manualCents(f);
  if (manual === null) return null;
  if (manual !== undefined) {
    return { id, type: 'other', params: { amount_cents: manual }, discountCents: manual, description: null };
  }
  const discount = computedDiscount(f);
  if (discount === null) return null;
  return { id, type: f.promoType, params: effectiveParams(f), discountCents: discount, description: null };
}

/** Pieces of a known variant are whole; a weighed or unlinked line takes up to 3 decimals. */
function wholePieces(f: LineForm): boolean {
  return !!f.variant && !f.variant.soldByWeight;
}

/** The line as it would be saved now, for the live total; null while something is missing. */
export function previewLine(f: LineForm, promoId: string | null = null): PurchaseLine | null {
  const q = parseAmount(f.quantity);
  const price = parseCents(f.price);
  if (q === null || price === null || (wholePieces(f) && !Number.isInteger(q))) return null;
  return {
    id: f.lineId,
    variant: f.variant,
    rawText: f.rawText,
    quantity: q,
    unitPriceCents: price,
    promotion: promotion(f, promoId),
  };
}

/** The line to save, or this form with what is missing. [promoId] keeps the id of the promotion it had. */
export function validateLine(
  f: LineForm,
  promoId: string | null = null,
): { line: PurchaseLine | null; form: LineForm } {
  const q = parseAmount(f.quantity);
  const manual = manualCents(f);
  const error =
    !f.variant && f.rawText === null
      ? 'Elige el producto.'
      : q === null
        ? 'Escribe una cantidad mayor que cero.'
        : wholePieces(f) && !Number.isInteger(q)
          ? 'Las piezas van en números enteros.'
          : parseCents(f.price) === null
            ? 'Escribe el precio.'
            : f.promoType && (manual === null || (manual === undefined && computedDiscount(f) === null))
              ? 'Completa los datos de la promoción.'
              : null;
  if (error) return { line: null, form: { ...f, error } };
  return { line: previewLine(f, promoId), form: f };
}
