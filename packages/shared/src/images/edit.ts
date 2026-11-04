import { z } from 'zod';

// The photo editor (10 §6.2, T-301). The original never changes: an edit is a mask over the whole photo plus
// `edit_params`, and the client renders `processed` and `thumb` from them. The rules here are the ones every editor
// follows, so a photo edited on one client opens the same on another.

export const ROTATIONS = [0, 90, 180, 270] as const;
export type Rotation = (typeof ROTATIONS)[number];

/** The margin around the subject of the initial crop: 8 % of its longer side, as the cut-outs of 10 §5. */
export const SUBJECT_MARGIN = 0.08;
/** `processed` is at most this side; the editor works on the photo reduced to it (T106). */
export const EDIT_MAX_SIDE = 1024;
export const THUMB_SIDE = 256;
export const WHITE = '#FFFFFF';

const unit = z.number().min(0).max(1);

/** A rectangle in fractions of the rotated photo. */
export const CropSchema = z
  .object({ x: unit, y: unit, w: z.number().gt(0).max(1), h: z.number().gt(0).max(1) })
  .refine((c) => c.x + c.w <= 1 + 1e-9 && c.y + c.h <= 1 + 1e-9, { message: 'El recorte sale de la foto' });
export type Crop = z.infer<typeof CropSchema>;

/** `images.edit_params` (10 §6.2). Unknown keys are kept, so a newer client's settings survive an older one. */
export const EditParamsSchema = z.looseObject({
  crop: CropSchema.optional(),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional(),
  background: z.object({ type: z.literal('color'), value: z.string().regex(/^#[0-9A-Fa-f]{6}$/) }).optional(),
  adjust: z.object({ brightness: z.number().min(-1).max(1), contrast: z.number().min(-1).max(1) }).optional(),
  manual: z.boolean().optional(),
});
export type EditParams = z.infer<typeof EditParamsSchema>;

/** The stored JSON, or nothing when it is missing or does not follow the schema. */
export function parseEditParams(raw: string | null | undefined): EditParams {
  if (!raw) return {};
  try {
    const parsed = EditParamsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

/** The background a photo without background is shown on (10 §1): the edit's color, white by default. */
export const backgroundOf = (params: EditParams) => (params.background?.value ?? WHITE).toUpperCase();

/** Width and height after turning [rotation] degrees clockwise. */
export const rotatedSize = (w: number, h: number, rotation: Rotation): [number, number] =>
  rotation % 180 === 0 ? [w, h] : [h, w];

/** The photo's pixel under the pixel ([rx], [ry]) of the photo turned [rotation] degrees clockwise. */
export function sourcePoint(
  rx: number,
  ry: number,
  w: number,
  h: number,
  rotation: Rotation,
): [number, number] {
  if (rotation === 90) return [ry, h - 1 - rx];
  if (rotation === 180) return [w - 1 - rx, h - 1 - ry];
  if (rotation === 270) return [w - 1 - ry, rx];
  return [rx, ry];
}

/** The same part of the photo once it turns [by] more degrees clockwise. */
export function rotateCrop(crop: Crop, by: Rotation): Crop {
  let c = crop;
  for (let turn = 0; turn < by / 90; turn++) c = { x: 1 - (c.y + c.h), y: c.x, w: c.h, h: c.w };
  return c;
}

/** A crop in whole pixels of a [w] × [h] picture, at least one pixel and inside it. */
export function cropPixels(crop: Crop | undefined, w: number, h: number) {
  if (!crop) return { x: 0, y: 0, w, h };
  const x = Math.min(w - 1, Math.max(0, Math.round(crop.x * w)));
  const y = Math.min(h - 1, Math.max(0, Math.round(crop.y * h)));
  return {
    x,
    y,
    w: Math.max(1, Math.min(w - x, Math.round(crop.w * w))),
    h: Math.max(1, Math.min(h - y, Math.round(crop.h * h))),
  };
}

/**
 * The initial crop (10 §6.2): the box of what the mask keeps (alpha > 0) with the 8 % margin, inside the photo.
 * Null when the mask keeps nothing or everything, where the whole photo is the crop.
 */
export function subjectCrop(alpha: ArrayLike<number>, w: number, h: number): Crop | null {
  let left = w;
  let top = h;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (alpha[y * w + x]! === 0) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < 0) return null;
  const margin = Math.round(Math.max(right - left + 1, bottom - top + 1) * SUBJECT_MARGIN);
  const x0 = Math.max(0, left - margin);
  const y0 = Math.max(0, top - margin);
  const x1 = Math.min(w, right + 1 + margin);
  const y1 = Math.min(h, bottom + 1 + margin);
  if (x0 === 0 && y0 === 0 && x1 === w && y1 === h) return null;
  return { x: x0 / w, y: y0 / h, w: (x1 - x0) / w, h: (y1 - y0) / h };
}

/** Brightness and contrast of one channel: v′ = (v − 128)(1 + contrast) + 128 + 255·brightness, rounded. */
export const adjustChannel = (v: number, brightness: number, contrast: number) =>
  Math.min(255, Math.max(0, Math.round((v - 128) * (1 + contrast) + 128 + 255 * brightness)));

/**
 * Sets the mask to [value] (0 erases, 255 restores) in the disc of [radius] pixels around ([cx], [cy]); returns
 * whether anything changed.
 */
export function paintDisc(
  alpha: Uint8Array | Uint8ClampedArray,
  w: number,
  h: number,
  cx: number,
  cy: number,
  radius: number,
  value: 0 | 255,
): boolean {
  let changed = false;
  const r2 = radius * radius;
  for (let y = Math.max(0, Math.floor(cy - radius)); y <= Math.min(h - 1, Math.ceil(cy + radius)); y++) {
    for (let x = Math.max(0, Math.floor(cx - radius)); x <= Math.min(w - 1, Math.ceil(cx + radius)); x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > r2 || alpha[y * w + x] === value) continue;
      alpha[y * w + x] = value;
      changed = true;
    }
  }
  return changed;
}

export interface Pixels {
  /** RGBA, row by row. */
  data: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
}

/**
 * The render of 10 §6.2 at the photo's size: the photo (opaque RGBA) with the mask as its alpha, turned, cropped,
 * and with brightness and contrast. Adjustments change the product, not the background it is shown on (hallazgo
 * T107), so a white background stays white.
 */
export function renderEdit(photo: Pixels, mask: ArrayLike<number>, params: EditParams): Pixels {
  const { width: w, height: h } = photo;
  const rotation = params.rotation ?? 0;
  const [rw, rh] = rotatedSize(w, h, rotation);
  const box = cropPixels(params.crop, rw, rh);
  const brightness = params.adjust?.brightness ?? 0;
  const contrast = params.adjust?.contrast ?? 0;
  const table = Array.from({ length: 256 }, (_, v) => adjustChannel(v, brightness, contrast));
  const out = new Uint8ClampedArray(box.w * box.h * 4);
  for (let y = 0; y < box.h; y++) {
    for (let x = 0; x < box.w; x++) {
      const [sx, sy] = sourcePoint(box.x + x, box.y + y, w, h, rotation);
      const from = sy * w + sx;
      const to = (y * box.w + x) * 4;
      out[to] = table[photo.data[from * 4]!]!;
      out[to + 1] = table[photo.data[from * 4 + 1]!]!;
      out[to + 2] = table[photo.data[from * 4 + 2]!]!;
      out[to + 3] = mask[from]!;
    }
  }
  return { data: out, width: box.w, height: box.h };
}
