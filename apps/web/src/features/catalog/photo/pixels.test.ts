import type { EditSourceResponse } from '@maunedas/shared/api/images';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadPhoto, workingSize } from './pixels';

// jsdom has no bitmaps: each file "decodes" to the size its URL says, and a canvas reads back its red value.
const SIZES: Record<string, [number, number]> = {
  'https://x/original.jpg': [2048, 1365],
  'https://x/mask.png': [1024, 683],
  'https://x/square.png': [1024, 1024],
};

const source = (mask: string | null): EditSourceResponse => ({
  image_id: 'i',
  updated_at: 1,
  original_url: 'https://x/original.jpg',
  edit_params: null,
  mask: mask ? { url: mask, width: null, height: null } : null,
  automatic: null,
});

beforeEach(() => {
  vi.stubGlobal('fetch', async (url: string) =>
    SIZES[url] ? new Response(url) : new Response(null, { status: 404 }),
  );
  vi.stubGlobal('createImageBitmap', async (blob: Blob) => {
    const [width, height] = SIZES[await blob.text()]!;
    return { width, height, close: () => {} };
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () =>
      ({
        drawImage: () => {},
        getImageData: (_x: number, _y: number, w: number, h: number) => ({
          data: new Uint8ClampedArray(w * h * 4).fill(90),
        }),
      }) as never,
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the photo the editor works on (10 §6.2, T106)', () => {
  it('fits in 1024 px keeping its shape, never enlarged', () => {
    expect(workingSize(2048, 1365)).toEqual([1024, 683]);
    expect(workingSize(3024, 4032)).toEqual([768, 1024]);
    expect(workingSize(800, 600)).toEqual([800, 600]);
    expect(workingSize(5000, 2)).toEqual([1024, 1]);
  });

  it('lays a mask of the same shape on it, by its red channel', async () => {
    const { photo, alpha, masked } = await loadPhoto(source('https://x/mask.png'));
    expect([photo.width, photo.height, photo.data.length]).toEqual([1024, 683, 1024 * 683 * 4]);
    expect([alpha.length, alpha[0], alpha[alpha.length - 1], masked]).toEqual([1024 * 683, 90, 90, true]);
  });

  it('keeps everything without a mask or with one of another shape', async () => {
    for (const mask of [null, 'https://x/square.png']) {
      const { alpha, masked } = await loadPhoto(source(mask));
      expect([alpha.length, alpha.every((a) => a === 255), masked]).toEqual([1024 * 683, true, false]);
    }
  });

  it('says when a file cannot be downloaded', async () => {
    await expect(loadPhoto(source('https://x/gone.png'))).rejects.toThrow('No se pudo abrir la foto.');
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('offline');
    });
    await expect(loadPhoto(source(null))).rejects.toThrow('No se pudo abrir la foto.');
  });
});
