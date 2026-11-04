import { z } from 'zod';

/** Why an XML cannot be imported (`422 E-UNSUPPORTED_CFDI`, `details.reason`, 03 §14). */
export const CFDI_REJECTIONS = [
  'NOT_XML',
  'NOT_CFDI',
  'NOT_INCOME',
  'NOT_MXN',
  'NO_UUID',
  'NO_LINES',
  'TOO_MANY_LINES',
] as const;
export type CfdiRejection = (typeof CFDI_REJECTIONS)[number];

/** The most lines an invoice may bring (a supermarket's are well below). */
export const CFDI_MAX_LINES = 300;

/** `POST /v1/purchases/cfdi/preview`: the invoice as text (≤ 2 MB). */
export const CfdiPreviewRequestSchema = z.strictObject({ xml: z.string().min(1).max(2_000_000) });

/** `POST /v1/purchases/cfdi`: the invoice and the store it is from. */
export const CfdiImportRequestSchema = z.strictObject({
  xml: z.string().min(1).max(2_000_000),
  store_id: z.uuid(),
});

/** A line as it is saved: what was paid, taxes included (the purchase keeps prices as paid). */
export interface CfdiLine {
  line_no: number;
  description: string;
  quantity: number;
  unit_price_cents: number;
  gross_cents: number;
  discount_cents: number;
  final_cents: number;
  /** `NoIdentificacion`: the issuer's code for the product, when it gives one. */
  sku: string | null;
  /** Linked by the store's receipt aliases; null when there is no store yet or no alias. */
  variant_id: string | null;
}

export interface CfdiPreviewResponse {
  fiscal_uuid: string;
  issued_at: number;
  emisor: { rfc: string; name: string | null };
  total_cents: number;
  lines: CfdiLine[];
  linked: number;
  /** The store this issuer was last imported to, or the one its name matches; null when unknown. */
  store_id: string | null;
  /** The live purchase this invoice already became, if any. */
  imported_purchase_id: string | null;
}

export interface CfdiImportResponse {
  purchase_id: string;
  lines: number;
  linked: number;
}
