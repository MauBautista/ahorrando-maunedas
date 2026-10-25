import type { ProductListItem, ProductsResponse } from '@maunedas/shared/api/catalog';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { ProductPhoto } from '../../components/ProductPhoto';
import { UnitPrice } from '../../components/UnitPrice';
import { useApi } from '../../lib/context';
import { ago } from '../../lib/format';
import { categoryTree, storeName, useLookups } from '../../lib/lookups';
import { useDebounced } from '../../lib/useDebounced';

/**
 * W-07 (05 §5 S-07): search by name, brand or code, filters by category (with its subcategories) and tag, and each
 * product with its best price per unit of the last 90 days (RF-PRE-05). The filters live in the URL, so a search can
 * be shared and survives going back.
 */
export function CatalogPage() {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const category = params.get('categoria') ?? '';
  const tag = params.get('etiqueta') ?? '';
  const search = useDebounced(q.trim());
  const { data: lookups } = useLookups();

  const products = useInfiniteQuery({
    queryKey: ['products', search, category, tag],
    queryFn: ({ pageParam }) => {
      const query = new URLSearchParams({ limit: '30' });
      if (search) query.set('q', search);
      if (category) query.set('category_id', category);
      if (tag) query.set('tag_id', tag);
      if (pageParam) query.set('cursor', pageParam);
      return api.get<ProductsResponse>(`/v1/products?${query}`);
    },
    initialPageParam: '',
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });

  const set = (key: string, value: string) =>
    setParams(
      (p) => {
        if (value) p.set(key, value);
        else p.delete(key);
        return p;
      },
      { replace: true },
    );
  const items = products.data?.pages.flatMap((p) => p.items) ?? [];
  const filtered = !!(search || category || tag);
  // Ages are counted from when the list arrived ("hoy", "hace 3 días").
  const now = products.dataUpdatedAt;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-title">Catálogo</h1>
        <Link to="/productos/nuevo" className="btn-primary inline-flex items-center">
          Nuevo producto
        </Link>
      </div>
      <div className="flex flex-col gap-3 md:flex-row">
        <input
          type="search"
          aria-label="Buscar por nombre, marca o código"
          placeholder="Buscar por nombre, marca o código"
          value={q}
          onChange={(e) => set('q', e.target.value)}
          className="field md:flex-1"
        />
        <select
          aria-label="Categoría"
          value={category}
          onChange={(e) => set('categoria', e.target.value)}
          className="field"
        >
          <option value="">Todas las categorías</option>
          {categoryTree(lookups?.categories ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {' '.repeat(c.depth)}
              {c.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Etiqueta"
          value={tag}
          onChange={(e) => set('etiqueta', e.target.value)}
          className="field"
        >
          <option value="">Todas las etiquetas</option>
          {(lookups?.tags ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
      {products.isPending ? (
        <p role="status" className="text-on-surface-variant">
          Cargando…
        </p>
      ) : products.isError ? (
        <p role="alert" className="text-error">
          {products.error.message}
        </p>
      ) : items.length === 0 ? (
        <p className="text-on-surface-variant">
          {filtered
            ? 'Ningún producto coincide con la búsqueda.'
            : 'Aún no hay productos. Agrega el primero con "Nuevo producto".'}
        </p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((p) => (
            <ProductCard key={p.id} product={p} storeOf={(id) => storeName(lookups, id)} now={now} />
          ))}
        </ul>
      )}
      {products.hasNextPage && (
        <button
          type="button"
          className="btn-outline self-center"
          disabled={products.isFetchingNextPage}
          onClick={() => void products.fetchNextPage()}
        >
          {products.isFetchingNextPage ? 'Cargando…' : 'Ver más'}
        </button>
      )}
    </section>
  );
}

function ProductCard({
  product: p,
  storeOf,
  now,
}: {
  product: ProductListItem;
  storeOf: (id: string) => string;
  now: number;
}) {
  return (
    <li>
      <Link
        to={`/productos/${p.id}`}
        className="flex gap-3 rounded-xl border border-outline/30 p-3 hover:bg-surface-variant"
      >
        <ProductPhoto image={p.image} name={p.name} className="size-16 shrink-0" />
        <div className="flex min-w-0 flex-col gap-1">
          <span className="font-medium">{p.name}</span>
          <span className="text-label text-on-surface-variant">
            {[p.brand, p.variants === 1 ? '1 presentación' : `${p.variants} presentaciones`]
              .filter(Boolean)
              .join(' · ')}
          </span>
          {p.best ? (
            <>
              <UnitPrice
                cents={p.best.display_cents}
                unit={p.best.display_unit}
                source={p.best.source}
                className="font-medium"
              />
              <span className="text-label text-on-surface-variant">
                {p.best.variant_label} en {storeOf(p.best.store_id)} · {ago(p.best.observed_at, now)}
              </span>
            </>
          ) : (
            <span className="text-label text-on-surface-variant">Sin precios en los últimos 90 días</span>
          )}
        </div>
      </Link>
    </li>
  );
}
