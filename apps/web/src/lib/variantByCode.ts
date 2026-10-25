import type { VariantSearchItem } from '@maunedas/shared/api/catalog';
import { useApi } from './context';

/**
 * The variant a scanned code belongs to, with its last list price at [storeId] (S-05, S-13), or null when the code is
 * not in the catalog: the exact code match of `GET /v1/search/variants`, which asks no open catalog.
 */
export function useVariantByCode() {
  const api = useApi();
  return async (code: string, storeId: string | null): Promise<VariantSearchItem | null> => {
    const params = new URLSearchParams({ q: code, limit: '5' });
    if (storeId) params.set('store_id', storeId);
    const { items } = await api.get<{ items: VariantSearchItem[] }>(`/v1/search/variants?${params}`);
    return items.find((i) => i.barcode_match) ?? null;
  };
}
