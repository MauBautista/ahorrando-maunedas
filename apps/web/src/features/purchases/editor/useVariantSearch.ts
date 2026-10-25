import type { VariantSearchItem } from '@maunedas/shared/api/catalog';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '../../../lib/context';
import { useDebounced } from '../../../lib/useDebounced';

/** S-05's search: words of product and label, or an exact code first, each with its last list price at [storeId]. */
export function useVariantSearch(query: string, storeId: string | null) {
  const api = useApi();
  const q = useDebounced(query.trim());
  return useQuery({
    queryKey: ['variant-search', q, storeId],
    enabled: q !== '',
    queryFn: () => {
      const params = new URLSearchParams({ q, limit: '20' });
      if (storeId) params.set('store_id', storeId);
      return api.get<{ items: VariantSearchItem[] }>(`/v1/search/variants?${params}`);
    },
  });
}
