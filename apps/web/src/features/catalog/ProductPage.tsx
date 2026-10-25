import type { ProductDetailResponse } from '@maunedas/shared/api/catalog';
import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { ProductPhoto } from '../../components/ProductPhoto';
import { ApiError } from '../../lib/api';
import { useApi } from '../../lib/context';
import { categoryPath, useLookups } from '../../lib/lookups';
import { useMe } from '../auth/useSession';
import { CompareTab } from './CompareTab';
import { VariantsTab } from './VariantsTab';

/** The chart library is big: it loads when the history is opened, not with the product. */
const HistoryTab = lazy(() => import('./HistoryTab').then((m) => ({ default: m.HistoryTab })));

const TABS = [
  { key: 'presentaciones', label: 'Presentaciones' },
  { key: 'comparar', label: 'Comparar' },
  { key: 'historial', label: 'Historial' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

/** W-08 (05 §5 S-08): the product with its variants, the comparator and the price history; the tab is in the URL. */
export function ProductPage() {
  const { id = '' } = useParams();
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const tab: TabKey = TABS.some((t) => t.key === params.get('vista'))
    ? (params.get('vista') as TabKey)
    : 'presentaciones';
  const { data: lookups } = useLookups();
  const { data: me } = useMe();
  const page = useQuery({
    queryKey: ['product', id],
    queryFn: () => api.get<ProductDetailResponse>(`/v1/products/${id}`),
  });

  if (page.isPending) return <p role="status">Cargando…</p>;
  if (page.isError) {
    const gone = page.error instanceof ApiError && page.error.status === 404;
    return (
      <section className="flex flex-col gap-3">
        <p role="alert">
          {gone ? 'Este producto ya no existe; quizá se borró o se fusionó con otro.' : page.error.message}
        </p>
        <Link to="/catalogo" className="btn-text self-start">
          Volver al catálogo
        </Link>
      </section>
    );
  }

  const { product, variants } = page.data;
  const path = categoryPath(lookups?.categories ?? [], product.category_id);
  return (
    <article className="flex flex-col gap-4">
      <header className="flex flex-col gap-3 md:flex-row md:items-start">
        <ProductPhoto
          image={product.image}
          name={product.name}
          large
          className="h-56 w-full md:size-48 md:shrink-0"
        />
        <div className="flex flex-col gap-2">
          <h1 className="text-display">{product.name}</h1>
          {(product.brand || path) && (
            <p className="text-on-surface-variant">{[product.brand, path].filter(Boolean).join(' · ')}</p>
          )}
          {product.tags.length > 0 && (
            <ul className="flex flex-wrap gap-2" aria-label="Etiquetas">
              {product.tags.map((t) => (
                <li key={t.id} className="rounded-sm bg-surface-variant px-2 py-1 text-label">
                  {t.name}
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            <Link to={`/productos/${product.id}/editar`} className="btn-outline inline-flex items-center">
              Editar
            </Link>
            <Link
              to={`/anaquel/nuevo?producto=${product.id}`}
              className="btn-outline inline-flex items-center"
            >
              Precio de anaquel
            </Link>
            {me?.user.role === 'admin' && (
              <Link
                to={`/admin/fusionar?producto=${product.id}`}
                className="btn-outline inline-flex items-center"
              >
                Fusionar con otro producto
              </Link>
            )}
          </div>
        </div>
      </header>
      <div
        role="tablist"
        aria-label="Secciones del producto"
        className="flex gap-1 border-b border-outline/30"
      >
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={`tab rounded-b-none ${tab === t.key ? 'tab-active' : ''}`}
            onClick={() => setParams((p) => (p.set('vista', t.key), p), { replace: true })}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === 'presentaciones' && (
          <VariantsTab variants={variants} lookups={lookups} now={page.dataUpdatedAt} />
        )}
        {tab === 'comparar' && <CompareTab productId={product.id} variants={variants} lookups={lookups} />}
        {tab === 'historial' && (
          <Suspense fallback={<p role="status">Cargando…</p>}>
            <HistoryTab variants={variants} lookups={lookups} />
          </Suspense>
        )}
      </div>
    </article>
  );
}
