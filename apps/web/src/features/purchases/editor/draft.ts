import type { VariantSearchItem } from '@maunedas/shared/api/catalog';
import type { PurchaseDetailItem, PurchaseDetailResponse } from '@maunedas/shared/api/purchases';
import { affectsPrice, type PromoParams, type PromoType } from '@maunedas/shared/pricing/promotions';
import {
  type LineAmounts,
  lineAmounts,
  purchaseTotals,
  type PurchaseTotals,
} from '@maunedas/shared/pricing/purchase';
import { centsPerBase, displayCents, type DisplayUnit, type Measure } from '@maunedas/shared/pricing/units';
import { decodeParams } from '../../../lib/promotions';

// The purchase being edited, as Android's `PurchaseDraft` and friends (core:data `PurchaseEditor`).

/** The variant a line points to, with what the line shows and computes. */
export interface LineVariant {
  id: string;
  productId: string;
  productName: string;
  label: string;
  brand: string | null;
  measure: Measure;
  unitAmount: number;
  packCount: number;
  soldByWeight: boolean;
  /** The product's unit, or the default one of the variant's measure (03 §3). */
  unit: DisplayUnit;
}

/** Why a line was cheaper (09 §6.1); [discountCents] is computed by `promotionDiscount` or typed by hand. */
export interface LinePromotion {
  id: string | null;
  type: PromoType;
  params: PromoParams;
  discountCents: number;
  description: string | null;
}

export interface PurchaseLine {
  id: string | null;
  variant: LineVariant | null;
  rawText: string | null;
  quantity: number;
  unitPriceCents: number;
  promotion: LinePromotion | null;
}

/** A discount of the whole ticket (RF-COM-05): a promotion of the purchase; their sum is `purchases.discount_cents`. */
export interface TicketDiscount {
  id: string | null;
  description: string;
  amountCents: number;
}

export interface PurchaseDraft {
  id: string | null;
  storeId: string | null;
  branchId: string | null;
  purchasedAt: number;
  lines: PurchaseLine[];
  ticketDiscounts: TicketDiscount[];
  /** "Total del ticket" as typed (RF-COM-06). */
  ticketTotalCents: number | null;
  confirmed: boolean;
  source: string;
  notes: string | null;
}

export function emptyDraft(now: number): PurchaseDraft {
  return {
    id: null,
    storeId: null,
    branchId: null,
    purchasedAt: now,
    lines: [],
    ticketDiscounts: [],
    ticketTotalCents: null,
    confirmed: false,
    source: 'manual',
    notes: null,
  };
}

export function amountsOf(line: PurchaseLine): LineAmounts {
  const promo = line.promotion;
  return lineAmounts(
    line.quantity,
    line.unitPriceCents,
    promo?.discountCents ?? null,
    promo ? affectsPrice(promo.type) : true,
  );
}

/** What was paid per display unit before the ticket discount ("$26.50/L" in S-04); null without a variant. */
export function perUnitCents(line: PurchaseLine): number | null {
  const v = line.variant;
  if (!v || line.quantity <= 0) return null;
  return displayCents(
    centsPerBase(amountsOf(line).final_cents, line.quantity, v.unitAmount, v.packCount),
    v.measure,
    v.unit,
  );
}

/** "Leche Lala · 1 L", or what the ticket said while the line has no product. */
export function lineTitle(line: PurchaseLine): string {
  return line.variant
    ? `${line.variant.productName} · ${line.variant.label}`
    : `Sin vincular: ${line.rawText ?? ''}`;
}

/** Whole pieces as "2"; weights with up to three decimals as "0.845". */
export function quantityText(quantity: number): string {
  return String(Number(quantity.toFixed(3)));
}

export function totalsOf(draft: PurchaseDraft): PurchaseTotals {
  return purchaseTotals(
    draft.lines.map((l) => amountsOf(l).final_cents),
    draft.ticketDiscounts.map((d) => d.amountCents),
    draft.ticketTotalCents,
  );
}

export function variantOfSearch(item: VariantSearchItem): LineVariant {
  return {
    id: item.variant_id,
    productId: item.product_id,
    productName: item.product_name,
    label: item.variant_label,
    brand: item.brand,
    measure: item.measure,
    unitAmount: item.unit_amount,
    packCount: item.pack_count,
    soldByWeight: item.sold_by_weight,
    unit: item.display_unit,
  };
}

function variantOfLine(item: PurchaseDetailItem): LineVariant | null {
  if (
    !item.variant_id ||
    !item.product_id ||
    item.measure === null ||
    item.unit_amount === null ||
    item.pack_count === null ||
    !item.display_unit
  )
    return null;
  return {
    id: item.variant_id,
    productId: item.product_id,
    productName: item.product_name ?? '',
    label: item.variant_label ?? '',
    brand: item.brand,
    measure: item.measure,
    unitAmount: item.unit_amount,
    packCount: item.pack_count,
    soldByWeight: item.sold_by_weight === true,
    unit: item.display_unit,
  };
}

/** The purchase of `GET /v1/purchases/:id` as the editor holds it (Android's `PurchaseEditor.load`). */
export function draftOf(detail: PurchaseDetailResponse): PurchaseDraft {
  const p = detail.purchase;
  return {
    id: p.id,
    storeId: p.store_id,
    branchId: p.branch_id,
    purchasedAt: p.purchased_at,
    lines: [...detail.items]
      .sort((a, b) => a.line_no - b.line_no)
      .map((item) => {
        const promo = detail.promotions.find((x) => x.purchase_item_id === item.id);
        return {
          id: item.id,
          variant: variantOfLine(item),
          rawText: item.raw_text,
          quantity: item.quantity,
          unitPriceCents: item.unit_price_cents,
          promotion: promo
            ? {
                id: promo.id,
                type: promo.type,
                params: decodeParams(promo.params),
                discountCents: promo.discount_cents,
                description: promo.description,
              }
            : null,
        };
      }),
    ticketDiscounts: detail.promotions
      .filter((x) => x.purchase_id === p.id)
      .sort((a, b) => a.created_at - b.created_at)
      .map((x) => ({ id: x.id, description: x.description ?? '', amountCents: x.discount_cents })),
    ticketTotalCents: p.total_cents,
    confirmed: p.status === 'confirmed',
    source: p.source,
    notes: p.notes,
  };
}
