import type { ProductDetailVariant } from '@maunedas/shared/api/catalog';
import {
  BULK_GRAMS,
  BULK_LABEL,
  type ContentUnit,
  CONTENT_UNITS,
  contentUnitsOf,
  forEditing,
  toBase,
} from '@maunedas/shared/catalog/content';
import { suggestVariantLabel } from '@maunedas/shared/catalog/quantity';
import type { Measure } from '@maunedas/shared/pricing/units';
import { parseAmount } from '@maunedas/shared/text/decimal';

/**
 * W-09's variant as typed, Android's `VariantForm` (S-10): `[pack] × [amount] [unit]`, "a granel", the label and the
 * codes. The label follows the suggestion ("6 × 1 L") until someone writes their own; clearing it brings it back.
 */
export interface VariantForm {
  id: string | null;
  measure: Measure;
  bulk: boolean;
  pack: string;
  amount: string;
  unit: ContentUnit;
  label: string;
  labelEdited: boolean;
  codes: string[];
  codeInput: string;
  codeError: string | null;
  packError: string | null;
  amountError: string | null;
  labelError: string | null;
}

export const emptyVariant = (): VariantForm => ({
  id: null,
  measure: 'volume',
  bulk: false,
  pack: '1',
  amount: '',
  unit: 'L',
  label: '',
  labelEdited: false,
  codes: [],
  codeInput: '',
  codeError: null,
  packError: null,
  amountError: null,
  labelError: null,
});

/** A saved variant in the assistant: kg or L from 1000 up; its own label counts as written by someone. */
export function variantFormOf(v: ProductDetailVariant): VariantForm {
  const { unit, amount } = forEditing(v.measure, v.unit_amount);
  return {
    ...emptyVariant(),
    id: v.id,
    measure: v.measure,
    bulk: v.sold_by_weight === 1,
    pack: String(v.pack_count),
    amount: v.sold_by_weight === 1 ? '' : String(amount),
    unit,
    label: v.label,
    labelEdited: true,
    codes: [...v.barcodes],
  };
}

const packCount = (f: VariantForm): number | null => {
  const n = Number(f.pack.trim());
  return /^\d+$/.test(f.pack.trim()) && n >= 1 ? n : null;
};
const baseAmount = (f: VariantForm): number | null => {
  const a = parseAmount(f.amount);
  return a === null ? null : toBase(a, f.unit);
};

/** "6 × 1 L", "946 ml", "A granel (kg)"; null while the content is not a number yet. */
export function suggestedLabel(f: VariantForm): string | null {
  if (f.bulk) return BULK_LABEL;
  const base = baseAmount(f);
  const packs = packCount(f);
  if (base === null || packs === null) return null;
  return suggestVariantLabel({ measure: f.measure, unit_amount: base, pack_count: packs });
}

const relabeled = (f: VariantForm): VariantForm =>
  f.labelEdited ? f : { ...f, label: suggestedLabel(f) ?? '' };

export const withMeasure = (f: VariantForm, measure: Measure): VariantForm =>
  relabeled({
    ...f,
    measure,
    unit: CONTENT_UNITS[f.unit].measure === measure ? f.unit : contentUnitsOf(measure)[0]!,
    bulk: f.bulk && measure === 'mass',
    amountError: null,
  });

/** Only by mass: one kilo in a pack of one (`VariantRowSchema`). */
export const withBulk = (f: VariantForm, bulk: boolean): VariantForm =>
  relabeled({ ...f, bulk: bulk && f.measure === 'mass', packError: null, amountError: null });
export const withPack = (f: VariantForm, pack: string): VariantForm =>
  relabeled({ ...f, pack, packError: null });
export const withAmount = (f: VariantForm, amount: string): VariantForm =>
  relabeled({ ...f, amount, amountError: null });
export const withUnit = (f: VariantForm, unit: ContentUnit): VariantForm =>
  relabeled({ ...f, unit, measure: CONTENT_UNITS[unit].measure, amountError: null });
export const withLabel = (f: VariantForm, label: string): VariantForm =>
  label.trim() === ''
    ? relabeled({ ...f, labelEdited: false, labelError: null })
    : { ...f, label, labelEdited: true, labelError: null };

const CODE = /^[0-9]{6,14}$/;

/** The typed code as the server stores it (spaces and dashes dropped), or why it cannot be added. */
export function checkCode(f: VariantForm): { code: string } | { error: string } {
  const code = f.codeInput.replace(/[\s-]/g, '');
  if (!CODE.test(code)) return { error: 'Un código tiene de 6 a 14 dígitos.' };
  if (f.codes.includes(code)) return { error: 'Ese código ya está en la lista.' };
  return { code };
}

export const withCode = (f: VariantForm, code: string): VariantForm => ({
  ...f,
  codes: f.codes.includes(code) ? f.codes : [...f.codes, code],
  codeInput: '',
  codeError: null,
});
export const withoutCode = (f: VariantForm, code: string): VariantForm => ({
  ...f,
  codes: f.codes.filter((c) => c !== code),
});

export interface VariantDraft {
  id: string | null;
  label: string;
  measure: Measure;
  unitAmount: number;
  packCount: number;
  soldByWeight: boolean;
  codes: string[];
}

/** The draft to save, or this form with its errors (Android's messages). */
export function validateVariant(f: VariantForm): { draft: VariantDraft | null; form: VariantForm } {
  const packs = f.bulk ? 1 : packCount(f);
  const base = f.bulk ? BULK_GRAMS : baseAmount(f);
  let amountError: string | null = null;
  if (!f.bulk && parseAmount(f.amount) === null)
    amountError = 'Escribe una cantidad mayor que cero, por ejemplo 1.5';
  else if (!f.bulk && CONTENT_UNITS[f.unit].integer && base !== null && !Number.isInteger(base))
    amountError = 'Las piezas van en números enteros.';
  const label = f.label.trim();
  const form: VariantForm = {
    ...f,
    packError: packs === null ? 'Escribe cuántas unidades trae el paquete (1 o más).' : null,
    amountError,
    labelError: label.length < 1 || label.length > 100 ? 'Escribe la etiqueta (hasta 100 caracteres).' : null,
  };
  if (packs === null || base === null || amountError || form.labelError) return { draft: null, form };
  return {
    draft: {
      id: f.id,
      label,
      measure: f.measure,
      unitAmount: base,
      packCount: packs,
      soldByWeight: f.bulk,
      codes: f.codes,
    },
    form,
  };
}
