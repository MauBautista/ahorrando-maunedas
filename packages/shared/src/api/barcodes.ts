import type { ParsedQuantity } from '../catalog/quantity';

/** Open catalogs, in lookup order (10 §2.1). */
export type CatalogSource = 'off' | 'obf' | 'opf';

/** A product found in an open catalog (`GET /v1/barcodes/:code`, 03 §8). */
export interface OpenCatalogEntry {
  source: CatalogSource;
  name: string | null;
  brand: string | null;
  /** As the catalog writes it, e.g. "6 x 1 l". */
  quantity_text: string | null;
  parsed: ParsedQuantity | null;
  image_url: string | null;
  license: string;
  attribution: string;
  source_url: string;
}

export interface BarcodeLookupResponse {
  /** Digits only. */
  code: string;
  match: { variant_id: string; product_id: string; product_name: string; variant_label: string } | null;
  /** Only when there is no match. */
  catalog: OpenCatalogEntry | null;
}

/** Spaces and hyphens are formatting; anything else that is not a digit makes the code invalid. */
export function normalizeBarcode(raw: string): string | null {
  const code = raw.replace(/[\s-]/g, '');
  return /^\d{6,14}$/.test(code) ? code : null;
}
