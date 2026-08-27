/** Scale (w, h) so the longer edge is at most `max`, preserving aspect
 *  ratio. Never upscales. Pure — the tested half of the resize. */
export function fitDimensions(
  w: number, h: number, max: number,
): { w: number; h: number } {
  const longEdge = Math.max(w, h);
  if (longEdge <= max) return { w, h };
  const scale = max / longEdge;
  return { w: Math.round(w * scale), h: Math.round(h * scale) };
}

/** Decode `file`, downscale to <= `max` px on the long edge, re-encode JPEG
 *  at `quality`. Browser-only (canvas). The spec's ~200 KB target comes from
 *  max=1080 / quality=0.8 on a typical phone photo. */
export async function resizeToJpeg(
  file: File, max = 1080, quality = 0.8,
): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const { w, h } = fitDimensions(bitmap.width, bitmap.height, max);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas is not supported on this device');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('could not encode the photo'))),
      'image/jpeg',
      quality,
    );
  });
}
