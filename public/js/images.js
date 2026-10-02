const MAX_SIDE = 1600;
const QUALITY = 0.85;

/**
 * Shrinks a phone photo (often 4000px+, several MB) to a JPEG data URL that is plenty
 * for recognising packaging, and much faster to upload and analyse.
 */
export async function photoToDataUrl(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', QUALITY);
}
