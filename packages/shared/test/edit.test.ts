import { describe, expect, it } from 'vitest';
import {
  adjustChannel,
  backgroundOf,
  cropPixels,
  paintDisc,
  parseEditParams,
  renderEdit,
  rotateCrop,
  rotatedSize,
  sourcePoint,
  subjectCrop,
  type Pixels,
} from '../src/images/edit';

/** A [w] × [h] photo whose red channel numbers its pixels, so a render says where each one came from. */
function numbered(w: number, h: number): Pixels {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([i, 100, 200, 255], i * 4);
  return { data, width: w, height: h };
}
const reds = (p: Pixels) => Array.from({ length: p.width * p.height }, (_, i) => p.data[i * 4]);
const alphas = (p: Pixels) => Array.from({ length: p.width * p.height }, (_, i) => p.data[i * 4 + 3]);

describe('edit_params (10 §6.2)', () => {
  it('reads what follows the schema and keeps keys it does not know', () => {
    const raw = JSON.stringify({
      crop: { x: 0.08, y: 0.05, w: 0.84, h: 0.9 },
      rotation: 90,
      background: { type: 'color', value: '#ffeedd' },
      adjust: { brightness: 0.05, contrast: 0.1 },
      manual: true,
      future: { a: 1 },
    });
    expect(parseEditParams(raw)).toEqual(JSON.parse(raw));
    expect(backgroundOf(parseEditParams(raw))).toBe('#FFEEDD');
  });

  it('treats a missing, broken or foreign value as no edit', () => {
    for (const raw of [
      null,
      undefined,
      '',
      'no es json',
      '[]',
      '{"rotation":45}',
      '{"crop":{"x":0.5,"y":0,"w":0.6,"h":1}}',
    ]) {
      expect(parseEditParams(raw)).toEqual({});
    }
    expect(backgroundOf({})).toBe('#FFFFFF');
    // A crop that reaches the edge exactly is inside.
    expect(parseEditParams('{"crop":{"x":0.25,"y":0,"w":0.75,"h":1}}').crop).toEqual({
      x: 0.25,
      y: 0,
      w: 0.75,
      h: 1,
    });
  });
});

describe('geometry', () => {
  it('turns sizes and crops clockwise', () => {
    expect(rotatedSize(4, 3, 0)).toEqual([4, 3]);
    expect(rotatedSize(4, 3, 90)).toEqual([3, 4]);
    expect(rotatedSize(4, 3, 180)).toEqual([4, 3]);
    expect(rotatedSize(4, 3, 270)).toEqual([3, 4]);
    const crop = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 };
    // The top-left part goes to the top-right once turned a quarter clockwise.
    const turned = rotateCrop(crop, 90);
    for (const [k, v] of Object.entries({ x: 0.4, y: 0.1, w: 0.4, h: 0.3 })) {
      expect(turned[k as keyof typeof turned]).toBeCloseTo(v);
    }
    expect(rotateCrop(crop, 0)).toEqual(crop);
    const back = rotateCrop(rotateCrop(crop, 180), 180);
    for (const k of ['x', 'y', 'w', 'h'] as const) expect(back[k]).toBeCloseTo(crop[k]);
    const quarter = rotateCrop(rotateCrop(crop, 90), 270);
    for (const k of ['x', 'y', 'w', 'h'] as const) expect(quarter[k]).toBeCloseTo(crop[k]);
  });

  it('finds the photo pixel under a turned one', () => {
    // A 3 × 2 photo: its top-left pixel ends top-right after a quarter clockwise.
    expect(sourcePoint(1, 0, 3, 2, 90)).toEqual([0, 0]);
    expect(sourcePoint(0, 2, 3, 2, 90)).toEqual([2, 1]);
    expect(sourcePoint(0, 0, 3, 2, 180)).toEqual([2, 1]);
    expect(sourcePoint(0, 0, 3, 2, 270)).toEqual([2, 0]);
    expect(sourcePoint(1, 1, 3, 2, 0)).toEqual([1, 1]);
  });

  it('crops whole pixels inside the picture', () => {
    expect(cropPixels(undefined, 10, 8)).toEqual({ x: 0, y: 0, w: 10, h: 8 });
    expect(cropPixels({ x: 0.25, y: 0.5, w: 0.5, h: 0.5 }, 10, 8)).toEqual({ x: 3, y: 4, w: 5, h: 4 });
    // Rounding never leaves the picture nor makes it empty.
    expect(cropPixels({ x: 0.96, y: 0.99, w: 0.04, h: 0.01 }, 10, 8)).toEqual({ x: 9, y: 7, w: 1, h: 1 });
    expect(cropPixels({ x: 0.5, y: 0, w: 0.5, h: 1 }, 3, 1)).toEqual({ x: 2, y: 0, w: 1, h: 1 });
  });

  it('starts from the subject with the 8 % margin', () => {
    // A 50 × 40 mask that keeps x 10..34 (25 px) and y 5..14 (10 px): the margin is round(25 × 0.08) = 2.
    const w = 50;
    const h = 40;
    const alpha = new Uint8Array(w * h);
    for (let y = 5; y < 15; y++) for (let x = 10; x < 35; x++) alpha[y * w + x] = 255;
    alpha[14 * w + 34] = 1;
    expect(subjectCrop(alpha, w, h)).toEqual({ x: 8 / w, y: 3 / h, w: 29 / w, h: 14 / h });
    // At the border, the margin stays inside.
    const corner = new Uint8Array(w * h);
    corner[0] = 255;
    corner[1 * w + 9] = 255;
    expect(subjectCrop(corner, w, h)).toEqual({ x: 0, y: 0, w: 11 / w, h: 3 / h });
    // Nothing kept, or everything: the whole photo.
    expect(subjectCrop(new Uint8Array(w * h), w, h)).toBeNull();
    expect(subjectCrop(new Uint8Array(w * h).fill(255), w, h)).toBeNull();
  });
});

describe('pixels', () => {
  it('adjusts brightness and contrast around the middle gray', () => {
    expect(adjustChannel(100, 0, 0)).toBe(100);
    expect(adjustChannel(100, 0.1, 0)).toBe(126);
    expect(adjustChannel(100, -1, 0)).toBe(0);
    expect(adjustChannel(100, 0, 0.5)).toBe(86);
    expect(adjustChannel(200, 0, 0.5)).toBe(236);
    expect(adjustChannel(200, 0, -1)).toBe(128);
    expect(adjustChannel(250, 0.2, 1)).toBe(255);
    expect(adjustChannel(10, 0.02, 0.1)).toBe(3);
  });

  it('paints a disc on the mask', () => {
    const w = 7;
    const alpha = new Uint8Array(w * 5).fill(255);
    expect(paintDisc(alpha, w, 5, 3, 2, 1, 0)).toBe(true);
    const erased = [...alpha.keys()].filter((i) => alpha[i] === 0).map((i) => [i % w, Math.floor(i / w)]);
    expect(erased).toEqual([
      [3, 1],
      [2, 2],
      [3, 2],
      [4, 2],
      [3, 3],
    ]);
    // Nothing to change, and a disc past the edge paints only what is inside.
    expect(paintDisc(alpha, w, 5, 3, 2, 1, 0)).toBe(false);
    expect(paintDisc(alpha, w, 5, -1, -1, 1.5, 0)).toBe(true);
    expect(alpha[0]).toBe(0);
    expect(paintDisc(alpha, w, 5, 3, 2, 0.5, 255)).toBe(true);
    expect(alpha[2 * w + 3]).toBe(255);
    expect(alpha[2 * w + 2]).toBe(0);
  });

  it('renders the photo turned, cropped and adjusted, with the mask as alpha', () => {
    // 3 × 2: pixels 0 1 2 / 3 4 5.
    const photo = numbered(3, 2);
    const mask = [0, 10, 20, 30, 40, 50];
    expect(reds(renderEdit(photo, mask, {}))).toEqual([0, 1, 2, 3, 4, 5]);
    expect(alphas(renderEdit(photo, mask, {}))).toEqual(mask);
    // A quarter clockwise: 2 × 3, 3 0 / 4 1 / 5 2.
    const turned = renderEdit(photo, mask, { rotation: 90 });
    expect([turned.width, turned.height]).toEqual([2, 3]);
    expect(reds(turned)).toEqual([3, 0, 4, 1, 5, 2]);
    expect(alphas(turned)).toEqual([30, 0, 40, 10, 50, 20]);
    expect(reds(renderEdit(photo, mask, { rotation: 180 }))).toEqual([5, 4, 3, 2, 1, 0]);
    expect(reds(renderEdit(photo, mask, { rotation: 270 }))).toEqual([2, 5, 1, 4, 0, 3]);
    // Cropped after turning: the bottom row of the quarter turn.
    const cropped = renderEdit(photo, mask, { rotation: 90, crop: { x: 0, y: 2 / 3, w: 1, h: 1 / 3 } });
    expect([cropped.width, cropped.height, ...reds(cropped)]).toEqual([2, 1, 5, 2]);
    // Adjustments change the color, never the alpha.
    const brighter = renderEdit(photo, mask, { adjust: { brightness: 0.1, contrast: 0 } });
    expect(Array.from(brighter.data.slice(0, 4))).toEqual([26, 126, 226, 0]);
    expect(alphas(brighter)).toEqual(mask);
  });
});
