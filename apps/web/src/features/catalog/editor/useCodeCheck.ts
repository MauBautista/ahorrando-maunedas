import type { VariantSearchItem } from '@maunedas/shared/api/catalog';
import { useApi } from '../../../lib/context';
import { checkCode, type VariantForm, withCode } from './variantForm';

/**
 * "Agregar código": its format first, then whether another variant already has it (05 §5 S-10). The search finds an
 * exact code without asking open catalogs, as `GET /v1/barcodes/:code` would.
 */
export function useCodeCheck() {
  const api = useApi();
  return async (form: VariantForm): Promise<VariantForm> => {
    const checked = checkCode(form);
    if ('error' in checked) return { ...form, codeError: checked.error };
    const { items } = await api.get<{ items: VariantSearchItem[] }>(
      `/v1/search/variants?q=${checked.code}&limit=5`,
    );
    const owner = items.find((i) => i.barcode_match && i.variant_id !== form.id);
    if (owner)
      return { ...form, codeError: `Ese código ya es de «${owner.product_name} · ${owner.variant_label}».` };
    return withCode(form, checked.code);
  };
}
