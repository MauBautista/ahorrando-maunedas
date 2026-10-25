import type { ProductDetailResponse } from '@maunedas/shared/api/catalog';
import type { DisplayUnit } from '@maunedas/shared/pricing/units';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useApi } from '../../../lib/context';
import { unitLabel } from '../../../lib/format';
import { categoryTree, useLookups } from '../../../lib/lookups';
import { type Mutation, push } from '../../../lib/sync';
import { useMe } from '../../auth/useSession';
import { conflictMessage } from './conflicts';
import {
  deleteProductMutations,
  deleteVariantMutations,
  productMutations,
  variantMutations,
} from './mutations';
import {
  addTypedTag,
  emptyProduct,
  followingMeasure,
  type ProductForm,
  productFormOf,
  toggleTag,
  validateProduct,
} from './productForm';
import { useCodeCheck } from './useCodeCheck';
import { VariantDialog } from './VariantDialog';
import { VariantFields } from './VariantFields';
import { emptyVariant, type VariantDraft, type VariantForm, validateVariant } from './variantForm';

const UNITS: DisplayUnit[] = ['kg', '100g', 'L', '100ml', 'pz'];

/** W-09 (05 §5 S-09, S-10, decision T56): `/productos/nuevo` with its first variant, or `/productos/:id/editar`. */
export function ProductEditorPage() {
  const { id } = useParams();
  const api = useApi();
  const page = useQuery({
    queryKey: ['product', id],
    queryFn: () => api.get<ProductDetailResponse>(`/v1/products/${id}`),
    enabled: !!id,
  });
  if (id && page.isPending) return <p role="status">Cargando…</p>;
  if (id && page.isError) return <p role="alert">{page.error.message}</p>;
  return <Editor key={id ?? 'nuevo'} page={id ? page.data! : null} />;
}

function Editor({ page }: { page: ProductDetailResponse | null }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: lookups } = useLookups();
  const { data: me } = useMe();
  const isAdmin = me?.user.role === 'admin';
  const checkCode = useCodeCheck();
  const [product, setProduct] = useState<ProductForm>(() =>
    page ? productFormOf(page.product) : emptyProduct(),
  );
  const [first, setFirst] = useState<VariantForm>(emptyVariant);
  const [dialog, setDialog] = useState<{ variantId: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);

  /** Pushes, refreshes every query (04 §7) and says what was not taken; true when everything was. */
  async function write(mutations: Mutation[], onError: (m: string) => void): Promise<boolean> {
    setBusy(true);
    try {
      const res = await push(api, mutations);
      await queryClient.invalidateQueries();
      // Someone else's change won (04 §3.2 STALE): the form starts over from what the server has now.
      const fresh = page && queryClient.getQueryData<ProductDetailResponse>(['product', page.product.id]);
      if (fresh && res.conflicts.some((c) => c.reason === 'STALE' && c.table === 'products'))
        setProduct(productFormOf(fresh.product));
      const problem = conflictMessage(res.conflicts);
      if (problem) onError(problem);
      return !problem;
    } catch (e) {
      onError(e instanceof Error ? e.message : 'No se pudo guardar.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveProduct() {
    const { draft, form } = validateProduct(product);
    setProduct(form);
    let variant: VariantDraft | null = null;
    if (!page) {
      const checked = validateVariant(first);
      setFirst(checked.form);
      variant = checked.draft;
      if (!variant) return;
    }
    if (!draft) return;
    const { productId, mutations } = productMutations(draft, page?.product ?? null);
    const all = variant ? [...mutations, ...variantMutations(productId, variant, null)] : mutations;
    if (await write(all, setMessage)) navigate(`/productos/${productId}`, { replace: true });
    else if (!page) navigate(`/productos/${productId}/editar`, { replace: true });
  }

  async function saveVariant(draft: VariantDraft) {
    if (!page) return;
    const existing = page.variants.find((v) => v.id === dialog?.variantId) ?? null;
    if (await write(variantMutations(page.product.id, draft, existing), setDialogError)) setDialog(null);
  }

  async function deleteVariant() {
    const existing = page?.variants.find((v) => v.id === dialog?.variantId);
    if (
      !existing ||
      !window.confirm(`¿Eliminar la presentación «${existing.label}»? Las compras y precios se conservan.`)
    )
      return;
    if (await write(deleteVariantMutations(existing), setDialogError)) setDialog(null);
  }

  async function deleteProduct() {
    if (
      !page ||
      !window.confirm(
        `¿Eliminar «${page.product.name}» y sus presentaciones? Las compras y precios se conservan.`,
      )
    )
      return;
    if (await write(deleteProductMutations(page), setMessage)) navigate('/catalogo', { replace: true });
  }

  const tags = lookups?.tags ?? [];
  return (
    <section className="flex max-w-2xl flex-col gap-4">
      <h1 className="text-title">{page ? 'Editar producto' : 'Nuevo producto'}</h1>
      <label className="flex flex-col gap-1">
        <span className="text-label">Nombre</span>
        <input
          value={product.name}
          onChange={(e) => setProduct((f) => ({ ...f, name: e.target.value, nameError: null }))}
          className="field"
          aria-invalid={!!product.nameError}
        />
      </label>
      {product.nameError && (
        <p role="alert" className="text-error">
          {product.nameError}
        </p>
      )}
      <label className="flex flex-col gap-1">
        <span className="text-label">Marca (opcional)</span>
        <input
          value={product.brand}
          onChange={(e) => setProduct((f) => ({ ...f, brand: e.target.value }))}
          className="field"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-label">Categoría</span>
        <select
          value={product.categoryId}
          onChange={(e) => setProduct((f) => ({ ...f, categoryId: e.target.value }))}
          className="field"
        >
          <option value="">Sin categoría</option>
          {categoryTree(lookups?.categories ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {' '.repeat(c.depth)}
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-label">Etiquetas</legend>
        <div className="flex flex-wrap gap-2">
          {tags.map((t) => (
            <label
              key={t.id}
              className={`tab border border-outline/40 ${product.tagIds.includes(t.id) ? 'tab-active' : ''}`}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={product.tagIds.includes(t.id)}
                onChange={() => setProduct((f) => toggleTag(f, t.id))}
              />
              {t.name}
            </label>
          ))}
          {product.newTags.map((name) => (
            <span key={name} className="tab tab-active border border-outline/40">
              {name} (nueva)
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            aria-label="Nueva etiqueta"
            placeholder="Nueva etiqueta"
            value={product.tagInput}
            onChange={(e) => setProduct((f) => ({ ...f, tagInput: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                setProduct((f) => addTypedTag(f, tags));
              }
            }}
            className="field flex-1"
          />
          <button
            type="button"
            className="btn-outline"
            onClick={() => setProduct((f) => addTypedTag(f, tags))}
          >
            Agregar
          </button>
        </div>
      </fieldset>
      <label className="flex flex-col gap-1">
        <span className="text-label">Comparar precios por</span>
        <select
          value={product.displayUnit}
          onChange={(e) =>
            setProduct((f) => ({ ...f, displayUnit: e.target.value as DisplayUnit, unitChosen: true }))
          }
          className="field"
        >
          {UNITS.map((u) => (
            <option key={u} value={u}>
              {unitLabel(u)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-label">Notas (opcional)</span>
        <textarea
          value={product.notes}
          onChange={(e) => setProduct((f) => ({ ...f, notes: e.target.value }))}
          className="field min-h-24 py-2"
        />
      </label>
      {page ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-title">Presentaciones</h2>
          <ul className="flex flex-col gap-2">
            {page.variants.map((v) => (
              <li key={v.id}>
                <button
                  type="button"
                  className="btn-outline w-full justify-start text-left"
                  onClick={() => (setDialogError(null), setDialog({ variantId: v.id }))}
                >
                  {v.label}
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="btn-text self-start"
            onClick={() => (setDialogError(null), setDialog({ variantId: null }))}
          >
            Agregar presentación
          </button>
        </section>
      ) : (
        <section className="flex flex-col gap-2">
          <h2 className="text-title">Primera presentación</h2>
          <VariantFields
            form={first}
            onChange={(change) =>
              setFirst((f) => {
                const next = change(f);
                setProduct((p) => followingMeasure(p, next.measure));
                return next;
              })
            }
            onAddCode={async () => setFirst(await checkCode(first))}
          />
        </section>
      )}
      {message && (
        <p role="alert" className="text-error">
          {message}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary" disabled={busy} onClick={() => void saveProduct()}>
          Guardar
        </button>
        <Link
          to={page ? `/productos/${page.product.id}` : '/catalogo'}
          className="btn-outline inline-flex items-center"
        >
          Cancelar
        </Link>
        {page && isAdmin && (
          <button
            type="button"
            className="btn-text ml-auto text-error"
            disabled={busy}
            onClick={() => void deleteProduct()}
          >
            Eliminar producto
          </button>
        )}
      </div>
      {dialog && (
        <VariantDialog
          variant={page?.variants.find((v) => v.id === dialog.variantId) ?? null}
          isAdmin={isAdmin}
          busy={busy}
          error={dialogError}
          onSave={(d) => void saveVariant(d)}
          onDelete={() => void deleteVariant()}
          onClose={() => setDialog(null)}
        />
      )}
    </section>
  );
}
