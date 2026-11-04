import type { ProductDetailResponse } from '@maunedas/shared/api/catalog';
import type { EditSourceResponse } from '@maunedas/shared/api/images';
import {
  backgroundOf,
  cropPixels,
  paintDisc,
  parseEditParams,
  renderEdit,
  rotateCrop,
  rotatedSize,
  sourcePoint,
  subjectCrop,
  type Crop,
  type EditParams,
  type Rotation,
} from '@maunedas/shared/images/edit';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useApi } from '../../../lib/context';
import { encodeMask, encodeProcessed, encodeThumb, loadPhoto, type EditablePhoto } from './pixels';
import { resetEdit, saveEdit } from './save';

const BACKGROUNDS = [
  { value: '#FFFFFF', label: 'Blanco' },
  { value: '#F2F2F2', label: 'Gris claro' },
  { value: '#000000', label: 'Negro' },
];
const TOOLS = [
  { key: 'crop', label: 'Recortar' },
  { key: 'erase', label: 'Borrar fondo' },
  { key: 'restore', label: 'Restaurar' },
] as const;
type Tool = (typeof TOOLS)[number]['key'];
const MAX_UNDO = 20;
/** A crop drawn smaller than this, in pixels of the photo, is taken as a slip. */
const MIN_CROP = 8;

/** W-08's photo editor (10 §6.2, T-301): the product's photo, never its original, changes. */
export function PhotoEditorPage() {
  const { id = '' } = useParams();
  const api = useApi();
  const product = useQuery({
    queryKey: ['product', id],
    queryFn: () => api.get<ProductDetailResponse>(`/v1/products/${id}`),
  });
  const imageId = product.data?.product.image?.image_id;
  // Read once: a refetch while editing would start the editor again.
  const source = useQuery({
    queryKey: ['photo-edit', imageId],
    enabled: imageId !== undefined,
    queryFn: () => api.get<EditSourceResponse>(`/v1/images/${imageId}/edit`),
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const pixels = useQuery({
    queryKey: ['photo-pixels', imageId, source.data?.updated_at],
    enabled: source.data !== undefined,
    queryFn: () => loadPhoto(source.data!),
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const back = `/productos/${id}`;
  const failed = product.error ?? source.error ?? pixels.error;
  const withoutPhoto = product.data !== undefined && !product.data.product.image;
  if (failed || withoutPhoto) {
    return (
      <section className="flex flex-col gap-3">
        <p role="alert">{failed ? failed.message : 'Este producto no tiene foto que editar.'}</p>
        <Link to={back} className="btn-text self-start">
          Volver al producto
        </Link>
      </section>
    );
  }
  if (!source.data || !pixels.data) return <p role="status">Abriendo la foto…</p>;
  return <PhotoEditor productId={id} source={source.data} loaded={pixels.data} />;
}

function PhotoEditor({
  productId,
  source,
  loaded,
}: {
  productId: string;
  source: EditSourceResponse;
  loaded: EditablePhoto;
}) {
  const api = useApi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { photo } = loaded;
  const saved = parseEditParams(source.edit_params);
  const [params, setParams] = useState<EditParams>(() => {
    const { manual, ...rest } = saved;
    const rotation = rest.rotation ?? 0;
    // A photo never edited by hand starts cropped to its product (10 §6.2).
    const subject = manual ? null : subjectCrop(loaded.alpha, photo.width, photo.height);
    return { ...rest, rotation, crop: rest.crop ?? (subject ? rotateCrop(subject, rotation) : undefined) };
  });
  const alpha = useRef(loaded.alpha.slice());
  const [maskVersion, setMaskVersion] = useState(0);
  const frame = useRef(0);
  const undo = useRef<Array<Uint8Array<ArrayBuffer>>>([]);
  const [undoCount, setUndoCount] = useState(0);
  const [tool, setTool] = useState<Tool>('crop');
  const [brush, setBrush] = useState(24);
  const [draft, setDraft] = useState<Crop | null>(null);
  const stroke = useRef<{ x: number; y: number } | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const rotation: Rotation = params.rotation ?? 0;
  const [rw, rh] = rotatedSize(photo.width, photo.height, rotation);
  const background = backgroundOf(params);
  const brightness = params.adjust?.brightness ?? 0;
  const contrast = params.adjust?.contrast ?? 0;

  // The preview: the whole photo turned and adjusted over its background, and the crop marked on it.
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    const full = renderEdit(photo, alpha.current, { rotation, adjust: { brightness, contrast } });
    const layer = document.createElement('canvas');
    layer.width = rw;
    layer.height = rh;
    layer.getContext('2d')?.putImageData(new ImageData(full.data, rw, rh), 0, 0);
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, rw, rh);
    ctx.drawImage(layer, 0, 0);
    const crop = draft ?? params.crop;
    if (!crop) return;
    const b = cropPixels(crop, rw, rh);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(0, 0, rw, b.y);
    ctx.fillRect(0, b.y + b.h, rw, rh - b.y - b.h);
    ctx.fillRect(0, b.y, b.x, b.h);
    ctx.fillRect(b.x + b.w, b.y, rw - b.x - b.w, b.h);
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = Math.max(2, Math.round(rw / 300));
    ctx.strokeRect(b.x, b.y, b.w, b.h);
  }, [photo, rotation, brightness, contrast, background, params.crop, draft, maskVersion, rw, rh]);

  /** Redraws once per frame however many times the brush paints in it. */
  function redraw() {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      setMaskVersion((v) => v + 1);
    });
  }

  function point(e: PointerEvent<HTMLCanvasElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * rw) / r.width, y: ((e.clientY - r.top) * rh) / r.height };
  }

  function between(a: { x: number; y: number }, b: { x: number; y: number }): Crop {
    const clamp = (v: number, max: number) => Math.min(max, Math.max(0, v));
    const x0 = clamp(Math.min(a.x, b.x), rw);
    const x1 = clamp(Math.max(a.x, b.x), rw);
    const y0 = clamp(Math.min(a.y, b.y), rh);
    const y1 = clamp(Math.max(a.y, b.y), rh);
    return { x: x0 / rw, y: y0 / rh, w: (x1 - x0) / rw, h: (y1 - y0) / rh };
  }

  /** Erases or restores along the stroke, in steps of a quarter of the brush so it leaves no gaps. */
  function paint(from: { x: number; y: number }, to: { x: number; y: number }) {
    const value = tool === 'erase' ? 0 : 255;
    const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / Math.max(1, brush / 4)));
    let changed = false;
    for (let i = 1; i <= steps; i++) {
      const [x, y] = sourcePoint(
        from.x + ((to.x - from.x) * i) / steps,
        from.y + ((to.y - from.y) * i) / steps,
        photo.width,
        photo.height,
        rotation,
      );
      changed = paintDisc(alpha.current, photo.width, photo.height, x, y, brush / 2, value) || changed;
    }
    if (changed) redraw();
  }

  function down(e: PointerEvent<HTMLCanvasElement>) {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // A pointer the browser no longer tracks: the stroke still works while it stays on the photo.
    }
    const p = point(e);
    stroke.current = p;
    if (tool === 'crop') return;
    undo.current = [...undo.current.slice(1 - MAX_UNDO), alpha.current.slice()];
    setUndoCount(undo.current.length);
    paint(p, p);
  }

  function move(e: PointerEvent<HTMLCanvasElement>) {
    const from = stroke.current;
    if (!from) return;
    const p = point(e);
    if (tool === 'crop') {
      setDraft(between(from, p));
      return;
    }
    paint(from, p);
    stroke.current = p;
  }

  function up(e: PointerEvent<HTMLCanvasElement>) {
    const from = stroke.current;
    stroke.current = null;
    if (!from || tool !== 'crop') return;
    setDraft(null);
    const p = point(e);
    if (Math.abs(p.x - from.x) < MIN_CROP || Math.abs(p.y - from.y) < MIN_CROP) return;
    setParams((ps) => ({ ...ps, crop: between(from, p) }));
  }

  function undoStroke() {
    const last = undo.current.pop();
    if (!last) return;
    alpha.current = last;
    setUndoCount(undo.current.length);
    redraw();
  }

  function turn(by: Rotation) {
    setParams((ps) => ({
      ...ps,
      rotation: (((ps.rotation ?? 0) + by) % 360) as Rotation,
      crop: ps.crop && rotateCrop(ps.crop, by),
    }));
  }

  function fitProduct() {
    const subject = subjectCrop(alpha.current, photo.width, photo.height);
    setParams((ps) => ({ ...ps, crop: subject ? rotateCrop(subject, rotation) : undefined }));
  }

  const setAdjust = (key: 'brightness' | 'contrast', value: number) =>
    setParams((ps) => ({ ...ps, adjust: { brightness, contrast, [key]: value } }));
  const setBackground = (value: string) =>
    setParams((ps) => ({ ...ps, background: { type: 'color', value: value.toUpperCase() } }));

  async function finish(work: () => Promise<void>) {
    setBusy(true);
    setProblem(null);
    try {
      await work();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['product', productId] }),
        queryClient.invalidateQueries({ queryKey: ['products'] }),
      ]);
      navigate(`/productos/${productId}`);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'No se pudo guardar la foto.');
      setBusy(false);
    }
  }

  const save = () =>
    finish(() =>
      saveEdit(api, source, photo, alpha.current, params, {
        processed: encodeProcessed,
        thumb: encodeThumb,
        mask: encodeMask,
      }),
    );
  const reset = () => finish(() => resetEdit(api, source));

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-display">Editar foto</h1>
      {source.mask && !loaded.masked && (
        <p role="status" className="text-on-surface-variant">
          La máscara guardada no corresponde a esta foto; se empieza sin quitar el fondo.
        </p>
      )}
      <div className="flex flex-col gap-4 md:flex-row md:items-start">
        <canvas
          ref={canvas}
          width={rw}
          height={rh}
          aria-label="Vista previa de la foto"
          className="w-full touch-none rounded-lg md:max-w-xl"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
        />
        <div className="flex flex-col gap-4 md:w-80">
          <div role="group" aria-label="Herramienta" className="flex flex-wrap gap-2">
            {TOOLS.map((t) => (
              <button
                key={t.key}
                type="button"
                aria-pressed={tool === t.key}
                className={`tab ${tool === t.key ? 'tab-active' : ''}`}
                onClick={() => setTool(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
          {tool === 'crop' ? (
            <div className="flex flex-wrap gap-2">
              <p className="w-full text-label text-on-surface-variant">
                Arrastra sobre la foto para marcar el recorte.
              </p>
              <button type="button" className="btn-outline" onClick={fitProduct}>
                Ajustar al producto
              </button>
              <button
                type="button"
                className="btn-outline"
                onClick={() => setParams((ps) => ({ ...ps, crop: undefined }))}
              >
                Foto completa
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-label text-on-surface-variant">
                {tool === 'erase'
                  ? 'Pasa el dedo o el ratón por el fondo que sobra.'
                  : 'Pasa el dedo o el ratón por lo que se borró de más.'}
              </p>
              <label className="flex flex-col gap-1 text-label">
                Tamaño del pincel
                <input
                  type="range"
                  min={4}
                  max={120}
                  value={brush}
                  onChange={(e) => setBrush(Number(e.target.value))}
                />
              </label>
              <button
                type="button"
                className="btn-outline self-start"
                disabled={undoCount === 0}
                onClick={undoStroke}
              >
                Deshacer
              </button>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-outline" onClick={() => turn(270)}>
              Girar a la izquierda
            </button>
            <button type="button" className="btn-outline" onClick={() => turn(90)}>
              Girar a la derecha
            </button>
          </div>
          <fieldset className="flex flex-wrap items-center gap-2">
            <legend className="mb-1 text-label">Fondo</legend>
            {BACKGROUNDS.map((b) => (
              <button
                key={b.value}
                type="button"
                aria-pressed={background === b.value}
                className={`tab border border-outline/40 ${background === b.value ? 'tab-active' : ''}`}
                onClick={() => setBackground(b.value)}
              >
                {b.label}
              </button>
            ))}
            <label className="flex items-center gap-2 text-label">
              Otro color
              <input
                type="color"
                value={background.toLowerCase()}
                onChange={(e) => setBackground(e.target.value)}
              />
            </label>
          </fieldset>
          <label className="flex flex-col gap-1 text-label">
            Brillo
            <input
              type="range"
              min={-0.5}
              max={0.5}
              step={0.05}
              value={brightness}
              onChange={(e) => setAdjust('brightness', Number(e.target.value))}
            />
          </label>
          <label className="flex flex-col gap-1 text-label">
            Contraste
            <input
              type="range"
              min={-0.5}
              max={0.5}
              step={0.05}
              value={contrast}
              onChange={(e) => setAdjust('contrast', Number(e.target.value))}
            />
          </label>
        </div>
      </div>
      {problem && (
        <p role="alert" className="text-error">
          {problem}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary" disabled={busy} onClick={save}>
          {busy ? 'Guardando…' : 'Guardar'}
        </button>
        {saved.manual && (
          <button type="button" className="btn-outline" disabled={busy} onClick={reset}>
            Restablecer
          </button>
        )}
        <Link to={`/productos/${productId}`} className="btn-text inline-flex items-center">
          Cancelar
        </Link>
      </div>
    </section>
  );
}
