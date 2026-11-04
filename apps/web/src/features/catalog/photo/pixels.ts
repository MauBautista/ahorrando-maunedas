import type { EditSourceResponse } from '@maunedas/shared/api/images';
import { EDIT_MAX_SIDE, THUMB_SIDE, type Pixels } from '@maunedas/shared/images/edit';

// The browser half of the photo editor (10 §6.2): decoding and encoding through a canvas. The editing itself is in
// `@maunedas/shared/images/edit`, on plain pixels.

type Canvas = OffscreenCanvas | HTMLCanvasElement;

function canvas(width: number, height: number): Canvas {
  // OffscreenCanvas exists in recent Safari; otherwise a plain canvas.
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return c;
}

const context = (c: Canvas) =>
  c.getContext('2d', { willReadFrequently: true }) as
    CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function toBlob(c: Canvas, type: string, quality?: number): Promise<Blob> {
  if ('convertToBlob' in c) return c.convertToBlob({ type, quality });
  return new Promise((resolve, reject) =>
    c.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('No se pudo guardar la foto.'))),
      type,
      quality,
    ),
  );
}

/** The size the editor works at: the photo upright and reduced to fit 1024 px, as the masks of T106. */
export function workingSize(width: number, height: number): [number, number] {
  const scale = Math.min(1, EDIT_MAX_SIDE / Math.max(width, height));
  return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))];
}

/** The original, upright by its EXIF orientation and at the working size, as opaque RGBA. */
export async function decodePhoto(blob: Blob): Promise<Pixels> {
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  const [width, height] = workingSize(bitmap.width, bitmap.height);
  const c = canvas(width, height);
  const ctx = context(c);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return { data: ctx.getImageData(0, 0, width, height).data, width, height };
}

/**
 * A mask PNG as one alpha byte per pixel of the working photo (its red channel, since the gray PNG may come back as
 * RGB). Null when its shape is not the photo's: a mask of the cropped square, from before T106, cannot be laid on it.
 */
export async function decodeMask(blob: Blob, width: number, height: number): Promise<Uint8Array | null> {
  const bitmap = await createImageBitmap(blob);
  const fits = Math.abs(bitmap.width / bitmap.height - width / height) <= 0.02;
  if (!fits) {
    bitmap.close();
    return null;
  }
  const c = canvas(width, height);
  const ctx = context(c);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const alpha = new Uint8Array(width * height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4]!;
  return alpha;
}

function draw(p: Pixels): Canvas {
  const c = canvas(p.width, p.height);
  context(c).putImageData(new ImageData(new Uint8ClampedArray(p.data), p.width, p.height), 0, 0);
  return c;
}

/** WebP at 0.85 as Android and the agent; a browser that cannot write WebP (Safari) gives a PNG. */
const encodeWebp = (c: Canvas) => toBlob(c, 'image/webp', 0.85);

/** `processed`: the render with its alpha. */
export const encodeProcessed = (rendered: Pixels) => encodeWebp(draw(rendered));

/** `thumb`: the render fitted in 256 px over the background. */
export function encodeThumb(rendered: Pixels, background: string): Promise<Blob> {
  const c = canvas(THUMB_SIDE, THUMB_SIDE);
  const ctx = context(c);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, THUMB_SIDE, THUMB_SIDE);
  const scale = THUMB_SIDE / Math.max(rendered.width, rendered.height);
  const w = Math.round(rendered.width * scale);
  const h = Math.round(rendered.height * scale);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(draw(rendered), Math.floor((THUMB_SIDE - w) / 2), Math.floor((THUMB_SIDE - h) / 2), w, h);
  return encodeWebp(c);
}

/** `mask`: the alpha over the whole working photo, as a gray PNG (T106). */
export function encodeMask(alpha: Uint8Array, width: number, height: number): Promise<Blob> {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < alpha.length; i++) rgba.set([alpha[i]!, alpha[i]!, alpha[i]!, 255], i * 4);
  return toBlob(draw({ data: rgba, width, height }), 'image/png');
}

/** `thumb` of an image already made (the AI's): fitted in 256 px over the background. */
export async function thumbFromUrl(url: string, background: string): Promise<Blob> {
  const bitmap = await createImageBitmap(await download(url));
  const c = canvas(THUMB_SIDE, THUMB_SIDE);
  const ctx = context(c);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, THUMB_SIDE, THUMB_SIDE);
  const scale = THUMB_SIDE / Math.max(bitmap.width, bitmap.height);
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, Math.floor((THUMB_SIDE - w) / 2), Math.floor((THUMB_SIDE - h) / 2), w, h);
  bitmap.close();
  return encodeWebp(c);
}

async function download(url: string): Promise<Blob> {
  const res = await fetch(url).catch(() => null);
  if (!res?.ok) throw new Error('No se pudo abrir la foto. Revisa tu conexión e intenta de nuevo.');
  return res.blob();
}

export interface EditablePhoto {
  photo: Pixels;
  alpha: Uint8Array;
  /** Whether a mask was laid on the photo; without one, everything is kept. */
  masked: boolean;
}

/** The original and the mask the editor starts from (10 §6.2). The URLs are signed, so no token is sent. */
export async function loadPhoto(source: EditSourceResponse): Promise<EditablePhoto> {
  const photo = await decodePhoto(await download(source.original_url));
  const alpha = source.mask
    ? await decodeMask(await download(source.mask.url), photo.width, photo.height)
    : null;
  return {
    photo,
    alpha: alpha ?? new Uint8Array(photo.width * photo.height).fill(255),
    masked: alpha !== null,
  };
}
