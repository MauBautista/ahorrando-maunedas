import type { PurchaseDetailResponse } from '@maunedas/shared/api/purchases';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '../../lib/context';

/** `GET /v1/purchases/:id` (03 §7), shared by the detail and the editor. */
export function usePurchase(id: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: ['purchase', id],
    enabled: !!id,
    queryFn: () => api.get<PurchaseDetailResponse>(`/v1/purchases/${id}`),
  });
}
