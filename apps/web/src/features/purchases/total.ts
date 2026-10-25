import type { PurchaseListItem } from '@maunedas/shared/api/purchases';

/** S-02: the ticket's total, or Σ lines − ticket discounts, never below zero (as RF-COM-06). */
export function purchaseTotal(
  p: Pick<PurchaseListItem, 'total_cents' | 'lines_total_cents' | 'discount_cents'>,
): number {
  return p.total_cents ?? Math.max(0, p.lines_total_cents - p.discount_cents);
}

export function linesText(n: number): string {
  return n === 1 ? '1 producto' : `${n} productos`;
}
