import type { LookupsResponse } from '@maunedas/shared/api/catalog';
import { useQuery } from '@tanstack/react-query';
import { useApi } from './context';

/** Stores, branches, categories and tags (`GET /v1/lookups`); they change seldom, so they are kept 5 minutes. */
export function useLookups() {
  const api = useApi();
  return useQuery({
    queryKey: ['lookups'],
    queryFn: () => api.get<LookupsResponse>('/v1/lookups'),
    staleTime: 5 * 60_000,
  });
}

type Category = LookupsResponse['categories'][number];

/** The category tree in display order (parents before children, by `sort_order` then name), with each depth. */
export function categoryTree(categories: Category[]): Array<Category & { depth: number }> {
  const children = new Map<string | null, Category[]>();
  for (const c of categories) children.set(c.parent_id, [...(children.get(c.parent_id) ?? []), c]);
  const ids = new Set(categories.map((c) => c.id));
  const out: Array<Category & { depth: number }> = [];
  const walk = (parent: string | null, depth: number) => {
    const level = [...(children.get(parent) ?? [])].sort(
      (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'es'),
    );
    for (const c of level) {
      out.push({ ...c, depth });
      walk(c.id, depth + 1);
    }
  };
  walk(null, 0);
  // A category whose parent is gone still shows, at the top.
  for (const c of categories) if (c.parent_id && !ids.has(c.parent_id)) out.push({ ...c, depth: 0 });
  return out;
}

/** "Refrigerados › Lácteos", as the product page of Android. */
export function categoryPath(categories: Category[], id: string | null): string | null {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const names: string[] = [];
  let current = id ? byId.get(id) : undefined;
  while (current && names.length < 10) {
    names.unshift(current.name);
    current = current.parent_id ? byId.get(current.parent_id) : undefined;
  }
  return names.length ? names.join(' › ') : null;
}

export function storeName(lookups: LookupsResponse | undefined, id: string): string {
  return lookups?.stores.find((s) => s.id === id)?.name ?? 'Tienda';
}
