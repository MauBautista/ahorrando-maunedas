import type { AlertEventsResponse, AlertRulesResponse } from '@maunedas/shared/api/alerts';
import type { ListingsResponse } from '@maunedas/shared/api/listings';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useApi } from '../../lib/context';

/** Every live listing, or those of one variant (`GET /v1/listings`, T-223). */
export function useListings(variantId: string | null, enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: ['listings', variantId],
    enabled,
    queryFn: () => api.get<ListingsResponse>(`/v1/listings${variantId ? `?variant_id=${variantId}` : ''}`),
  });
}

/** My live alert rules, or those of one variant. */
export function useRules(variantId: string | null) {
  const api = useApi();
  return useQuery({
    queryKey: ['alert-rules', variantId],
    queryFn: () =>
      api.get<AlertRulesResponse>(`/v1/alerts/rules${variantId ? `?variant_id=${variantId}` : ''}`),
  });
}

/** My alerts, newest first, 30 at a time. */
export function useAlertEvents() {
  const api = useApi();
  return useInfiniteQuery({
    queryKey: ['alert-events'],
    queryFn: ({ pageParam }) =>
      api.get<AlertEventsResponse>(`/v1/alerts/events${pageParam ? `?cursor=${pageParam}` : ''}`),
    initialPageParam: '',
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
}
