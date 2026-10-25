import type { PromoType } from '@maunedas/shared/pricing/promotions';
import { shelfEffectiveCents } from '@maunedas/shared/pricing/shelf';
import { centsPerBase, displayCents } from '@maunedas/shared/pricing/units';
import { parseCents } from '@maunedas/shared/text/decimal';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { ProductPhoto } from '../../components/ProductPhoto';
import { ScanDialog } from '../../components/ScanDialog';
import { UnknownCode } from '../../components/UnknownCode';
import { useApi } from '../../lib/context';
import { formatMoney, formatUnitPrice } from '../../lib/format';
import { downscaleToJpeg, PHOTO } from '../../lib/images';
import { push } from '../../lib/sync';
import { useVariantByCode } from '../../lib/variantByCode';
import { conflictMessage } from '../catalog/editor/conflicts';
import { PlaceFields } from '../places/PlaceFields';
import { type LineVariant, variantOfSearch } from '../purchases/editor/draft';
import type { ParamKey } from '../purchases/editor/lineForm';
import { PromotionFields } from '../purchases/editor/PromotionFields';
import { useVariantSearch } from '../purchases/editor/useVariantSearch';
import { lastPlace, rememberPlace, shelfMutations } from './shelf';

const MONEY = new Set<ParamKey>(['to_cents', 'member_cents', 'amount_cents']);

function paramsOf(texts: Partial<Record<ParamKey, string>>) {
  const out: Record<string, number> = {};
  for (const [k, text] of Object.entries(texts) as Array<[ParamKey, string]>) {
    const v = MONEY.has(k) ? parseCents(text) : text.trim() === '' ? null : Number(text.replace(',', '.'));
    if (v !== null && Number.isFinite(v) && v >= 0) out[k] = v;
  }
  return out;
}

/**
 * W-10 (05 §5 S-13, RF-PRE-01): a price seen on the shelf. The product (search or scan; S-13 does not create
 * products), the store and branch (the last ones of this browser), the price, an optional promotion with what one unit
 * costs with it, and an optional photo, reduced in the browser. "Guardar y otro" keeps the store for the next price.
 */
export function ShelfPage() {
  const api = useApi();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const variantByCode = useVariantByCode();
  const [variant, setVariant] = useState<LineVariant | null>(null);
  const [query, setQuery] = useState('');
  const [unknown, setUnknown] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [place, setPlace] = useState(
    () => lastPlace() ?? { storeId: null as string | null, branchId: null as string | null },
  );
  const [price, setPrice] = useState('');
  const [promoType, setPromoType] = useState<PromoType | null>(null);
  const [params, setParams] = useState<Partial<Record<ParamKey, string>>>({});
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const results = useVariantSearch(variant ? '' : query, place.storeId);
  // The preview's URL is let go when the photo changes or the page closes.
  useEffect(() => {
    if (!photo) return;
    return () => URL.revokeObjectURL(photo.url);
  }, [photo]);

  const priceCents = parseCents(price);
  const promo = promoType ? paramsOf(params) : {};
  const effective =
    promoType && priceCents !== null ? shelfEffectiveCents(promoType, promo, priceCents) : null;
  const perUnit = (cents: number) =>
    variant
      ? formatUnitPrice(
          displayCents(
            centsPerBase(cents, 1, variant.unitAmount, variant.packCount),
            variant.measure,
            variant.unit,
          ),
          variant.unit,
        )
      : null;

  async function scanned(code: string) {
    setScanning(false);
    try {
      const item = await variantByCode(code, place.storeId);
      if (!item) return setUnknown(code);
      setVariant(variantOfSearch(item));
      setUnknown(null);
      setQuery('');
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'No se pudo buscar el código.');
    }
  }

  async function takePhoto(file: File | undefined) {
    if (!file) return;
    try {
      const blob = await downscaleToJpeg(file, PHOTO.maxSide, PHOTO.quality);
      setPhoto({ blob, url: URL.createObjectURL(blob) });
    } catch {
      setProblem('No se pudo leer la foto. Intenta otra vez.');
    }
  }

  async function save(another: boolean) {
    const need = !variant
      ? 'Elige el producto.'
      : !place.storeId
        ? 'Elige la tienda.'
        : priceCents === null || priceCents <= 0
          ? 'Escribe el precio.'
          : null;
    if (need) return setProblem(need);
    const { imageId, mutations } = shelfMutations({
      variantId: variant!.id,
      storeId: place.storeId!,
      branchId: place.branchId,
      priceCents: priceCents!,
      promoType,
      promoParams: promo,
      photo: !!photo,
    });
    setBusy(true);
    try {
      const res = await push(api, mutations);
      const message = conflictMessage(res.conflicts);
      if (message) return setProblem(message);
      rememberPlace(place.storeId!, place.branchId);
      // The rows exist now, so the photo has an owner to upload to (06 §5).
      let photoFailed = false;
      if (imageId && photo) {
        try {
          await api.put(`/v1/images/${imageId}/blobs/original.jpg`, photo.blob);
        } catch {
          photoFailed = true;
        }
      }
      await queryClient.invalidateQueries();
      const done = photoFailed ? 'El precio se guardó, pero la foto no se pudo subir.' : 'Precio guardado';
      if (!another && !photoFailed) return navigate(`/productos/${variant!.productId}`);
      setSaved(done);
      setVariant(null);
      setPrice('');
      setPromoType(null);
      setParams({});
      setPhoto(null);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'No se pudo guardar.');
    } finally {
      setBusy(false);
    }
  }

  const change = () => {
    setProblem(null);
    setSaved(null);
  };

  return (
    <section className="flex max-w-2xl flex-col gap-4">
      <h1 className="text-title">Precio de anaquel</h1>
      {saved && (
        <p role="status" className="rounded-lg bg-surface-variant p-2">
          {saved}
        </p>
      )}
      {variant ? (
        <div className="flex items-center justify-between gap-3">
          <span className="font-medium">
            {variant.productName} · {variant.label}
          </span>
          <button type="button" className="btn-text" onClick={() => setVariant(null)}>
            Cambiar
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <input
              type="search"
              aria-label="Buscar producto o código"
              placeholder="Buscar producto o código"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setUnknown(null);
                change();
              }}
              className="field flex-1"
            />
            <button type="button" className="btn-outline" onClick={() => setScanning(true)}>
              Escanear código
            </button>
          </div>
          {unknown && <UnknownCode code={unknown} />}
          {results.data?.items.length === 0 && (
            <p className="text-on-surface-variant">
              Nada coincide. Si es un producto nuevo, dalo de alta en Catálogo.
            </p>
          )}
          <ul className="flex flex-col gap-1">
            {results.data?.items.map((item) => (
              <li key={item.variant_id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-surface-variant"
                  onClick={() => {
                    setVariant(variantOfSearch(item));
                    setQuery('');
                    change();
                  }}
                >
                  <ProductPhoto image={item.image} name={item.product_name} className="size-10 shrink-0" />
                  <span>
                    {item.product_name} · {item.variant_label}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        <PlaceFields
          storeId={place.storeId}
          branchId={place.branchId}
          onChange={(storeId, branchId) => {
            setPlace({ storeId, branchId });
            change();
          }}
          onProblem={setProblem}
        />
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-label">
          {variant?.soldByWeight ? 'Precio por kilo en el anaquel' : 'Precio en el anaquel'}
        </span>
        <input
          inputMode="decimal"
          placeholder="0.00"
          value={price}
          onChange={(e) => {
            setPrice(e.target.value);
            change();
          }}
          className="field"
        />
      </label>
      <PromotionFields
        type={promoType}
        params={params}
        onType={(type) => {
          setPromoType(type);
          setParams({});
          change();
        }}
        onParam={(key, text) => {
          setParams((p) => ({ ...p, [key]: text }));
          change();
        }}
      />
      {priceCents !== null && variant && (
        <p className="font-medium">
          {promoType === 'msi'
            ? 'Los meses sin intereses no cambian el precio.'
            : effective !== null
              ? `Con la promoción: ${formatMoney(effective)} cada uno · ${perUnit(effective)}`
              : `Por unidad: ${perUnit(priceCents)}`}
        </p>
      )}
      {photo ? (
        <div className="flex items-end gap-3">
          <img
            src={photo.url}
            alt="Foto del anaquel"
            className="h-32 rounded-lg border border-outline/30 object-cover"
          />
          <button type="button" className="btn-text" onClick={() => setPhoto(null)}>
            Quitar foto
          </button>
        </div>
      ) : (
        <label className="btn-outline inline-flex cursor-pointer items-center self-start">
          Tomar foto del anaquel
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={(e) => {
              void takePhoto(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
      )}
      {problem && (
        <p role="alert" className="text-error">
          {problem}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className="btn-outline" disabled={busy} onClick={() => void save(true)}>
          Guardar y otro
        </button>
        <button type="button" className="btn-primary" disabled={busy} onClick={() => void save(false)}>
          Guardar
        </button>
      </div>
      {scanning && <ScanDialog onCode={(code) => void scanned(code)} onClose={() => setScanning(false)} />}
    </section>
  );
}
