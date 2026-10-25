import { plainCents } from '@maunedas/shared/text/decimal';
import { useState } from 'react';
import { Dialog } from '../../../components/Dialog';
import { ProductPhoto } from '../../../components/ProductPhoto';
import { formatMoney, formatUnitPrice } from '../../../lib/format';
import { amountsOf, type PurchaseLine, perUnitCents } from './draft';
import {
  computedDiscount,
  type LineForm,
  previewLine,
  step,
  validateLine,
  withPromo,
  withVariant,
} from './lineForm';
import { PromotionFields } from './PromotionFields';
import { useVariantSearch } from './useVariantSearch';

/**
 * S-05 over the editor: the variant (search by words or code, each with "Último aquí"), quantity (a stepper, or
 * kilos when weighed), list price, promotion and the line's live total and effective price. "Guardar y otro" keeps
 * the dialog open for the next product.
 */
export function LineDialog({
  form: initial,
  storeId,
  promoId,
  onSave,
  onClose,
}: {
  form: LineForm;
  storeId: string | null;
  promoId: string | null;
  onSave: (line: PurchaseLine, another: boolean) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState(initial);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(!initial.variant);
  const results = useVariantSearch(searching ? query : '', storeId);
  const change = (next: Partial<LineForm>) => setForm((f) => ({ ...f, ...next, error: null }));
  const preview = previewLine(form, promoId);
  const bulk = !!form.variant?.soldByWeight;
  const discount = form.promoType ? computedDiscount(form) : null;

  function save(another: boolean) {
    const { line, form: checked } = validateLine(form, promoId);
    setForm(checked);
    if (!line) return;
    onSave(line, another);
    if (another) {
      setForm({
        ...initial,
        lineId: null,
        variant: null,
        rawText: null,
        quantity: '1',
        price: '',
        promoType: null,
        params: {},
        manualDiscount: null,
      });
      setSearching(true);
      setQuery('');
    }
  }

  return (
    <Dialog title="Producto de la compra" onClose={onClose}>
      <div className="flex flex-col gap-3">
        {form.rawText !== null && <p className="text-on-surface-variant">En el ticket: {form.rawText}</p>}
        {form.variant && !searching ? (
          <div className="flex items-center justify-between gap-3">
            <span className="font-medium">
              {form.variant.productName} · {form.variant.label}
            </span>
            <button type="button" className="btn-text" onClick={() => setSearching(true)}>
              Cambiar
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <input
              type="search"
              aria-label="Buscar producto o código"
              placeholder="Buscar producto o código"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="field"
            />
            {results.data?.items.length === 0 && (
              <p className="text-on-surface-variant">Sin resultados. Agrégalo primero en Catálogo.</p>
            )}
            <ul className="flex flex-col gap-1">
              {results.data?.items.map((item) => (
                <li key={item.variant_id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-surface-variant"
                    onClick={() => {
                      setForm((f) => withVariant(f, item));
                      setSearching(false);
                      setQuery('');
                    }}
                  >
                    <ProductPhoto image={item.image} name={item.product_name} className="size-10 shrink-0" />
                    <span className="flex flex-1 flex-col">
                      <span>
                        {item.product_name} · {item.variant_label}
                      </span>
                      {item.last_unit_cents !== null && (
                        <span className="text-label text-on-surface-variant">
                          Último aquí: {formatMoney(item.last_unit_cents)}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex flex-wrap items-end gap-3">
          {bulk || !form.variant ? (
            <label className="flex w-32 flex-col gap-1">
              <span className="text-label">{bulk ? 'Kilos' : 'Cantidad'}</span>
              <input
                inputMode="decimal"
                value={form.quantity}
                onChange={(e) => change({ quantity: e.target.value })}
                className="field"
              />
            </label>
          ) : (
            <div className="flex items-end gap-1">
              <button
                type="button"
                className="btn-outline px-4"
                aria-label="Una menos"
                onClick={() => setForm((f) => step(f, -1))}
              >
                −
              </button>
              <label className="flex w-20 flex-col gap-1">
                <span className="text-label">Cantidad</span>
                <input
                  inputMode="numeric"
                  value={form.quantity}
                  onChange={(e) => change({ quantity: e.target.value })}
                  className="field text-center"
                />
              </label>
              <button
                type="button"
                className="btn-outline px-4"
                aria-label="Una más"
                onClick={() => setForm((f) => step(f, 1))}
              >
                +
              </button>
            </div>
          )}
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-label">{bulk ? 'Precio por kilo' : 'Precio unitario'}</span>
            <input
              inputMode="decimal"
              value={form.price}
              placeholder="0.00"
              onChange={(e) => change({ price: e.target.value })}
              className="field"
            />
          </label>
        </div>
        <PromotionFields
          type={form.promoType}
          params={form.params}
          onType={(type) => setForm((f) => withPromo(f, type))}
          onParam={(key, text) => change({ params: { ...form.params, [key]: text } })}
        />
        {form.promoType && form.promoType !== 'msi' && (
          <div className="flex flex-col gap-2">
            {discount !== null && form.manualDiscount === null && (
              <span>Descuento: {formatMoney(discount)}</span>
            )}
            <label className="inline-flex min-h-12 items-center gap-2">
              <input
                type="checkbox"
                checked={form.manualDiscount !== null}
                onChange={(e) =>
                  change({
                    manualDiscount: e.target.checked ? (discount === null ? '' : plainCents(discount)) : null,
                  })
                }
              />
              Ajustar el descuento a mano
            </label>
            {form.manualDiscount !== null && (
              <label className="flex flex-col gap-1">
                <span className="text-label">Descuento</span>
                <input
                  inputMode="decimal"
                  value={form.manualDiscount}
                  onChange={(e) => change({ manualDiscount: e.target.value })}
                  className="field"
                />
              </label>
            )}
          </div>
        )}
        {preview && (
          <p className="flex flex-wrap gap-x-4">
            <span className="font-medium">
              Total de la línea: {formatMoney(amountsOf(preview).final_cents)}
            </span>
            {perUnitCents(preview) !== null && form.variant && (
              <span className="text-on-surface-variant">
                Precio efectivo: {formatUnitPrice(perUnitCents(preview)!, form.variant.unit)}
              </span>
            )}
          </p>
        )}
        {form.error && (
          <p role="alert" className="text-error">
            {form.error}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="btn-outline" onClick={onClose}>
            Cancelar
          </button>
          {!form.lineId && (
            <button type="button" className="btn-outline" onClick={() => save(true)}>
              Guardar y otro
            </button>
          )}
          <button type="button" className="btn-primary" onClick={() => save(false)}>
            Guardar
          </button>
        </div>
      </div>
    </Dialog>
  );
}
