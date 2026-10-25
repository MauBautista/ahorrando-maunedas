// Photos taken in the browser (06 §5): reduced and re-encoded before they leave, so the copy carries no EXIF (and
// no location), as Android's `LocalPhotos.reduce`.

/** Shelf and product photos: 2048 px at 0.85 (06 §5, as Android). */
export const PHOTO = { maxSide: 2048, quality: 0.85 };

/** The longest side at most [maxSide], upright by its EXIF orientation, as a JPEG. */
export async function downscaleToJpeg(file: Blob, maxSide: number, quality: number): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  // OffscreenCanvas exists in recent Safari; otherwise a plain canvas.
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    return canvas.convertToBlob({ type: 'image/jpeg', quality });
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('No se pudo leer la foto.'))),
      'image/jpeg',
      quality,
    ),
  );
}
