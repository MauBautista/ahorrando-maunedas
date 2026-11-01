import type { ProductDetailResponse } from '@maunedas/shared/api/catalog';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '../../lib/context';

export interface ChosenVariant {
  variant_id: string;
  product_id: string;
  product_name: string;
  variant_label: string;
}

/**
 * The variant of `?producto=&variante=` (the links of the product page), named from the product page's own query
 * so it usually comes from cache.
 */
export function usePresetVariant(productId: string | null, variantId: string | null): ChosenVariant | null {
  const api = useApi();
  const product = useQuery({
    queryKey: ['product', productId],
    queryFn: () => api.get<ProductDetailResponse>(`/v1/products/${productId}`),
    enabled: !!productId && !!variantId,
  });
  const v = product.data?.variants.find((x) => x.id === variantId);
  return v && product.data
    ? {
        variant_id: v.id,
        product_id: product.data.product.id,
        product_name: product.data.product.name,
        variant_label: v.label,
      }
    : null;
}
