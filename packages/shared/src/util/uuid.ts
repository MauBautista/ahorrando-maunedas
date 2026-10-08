import { v5, v7 } from 'uuid';

// Fixed forever: changing them would change every deterministic id (SDD 04 §2.1, fixtures/ids.json).
export const NS_PRODUCT_TAGS = '2bbba539-5872-4d57-8ff4-222c52764194';
export const NS_RECEIPT_ALIASES = '1258c7ae-83bc-44c3-be9d-5e4ce482dbb8';

/** Client-generated, time-ordered id for every synced row. */
export function uuidv7(nowMs?: number): string {
  return nowMs === undefined ? v7() : v7({ msecs: nowMs });
}

/** Name-based id (SHA-1, RFC 9562); the name is encoded as UTF-8. */
export function uuidv5(name: string, namespace: string): string {
  return v5(name, namespace);
}

export function productTagId(productId: string, tagId: string): string {
  return uuidv5(`${productId}:${tagId}`, NS_PRODUCT_TAGS);
}

export function receiptAliasId(storeId: string, rawTextNorm: string): string {
  return uuidv5(`${storeId}:${rawTextNorm}`, NS_RECEIPT_ALIASES);
}
