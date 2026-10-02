import { ValidationError } from './errors.ts';

export const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ImageMimeType = (typeof IMAGE_MIME_TYPES)[number];

export interface ImageInput {
  readonly mimeType: ImageMimeType;
  readonly data: Buffer;
}

// The browser shrinks photos to ~1600 px JPEG (a few hundred KB), so these are generous caps.
export const IMAGE_LIMITS = { maxImages: 6, maxBytesPerImage: 4 * 1024 * 1024 } as const;

const DATA_URL = /^data:(image\/[a-z+.-]+);base64,([A-Za-z0-9+/=\s]+)$/;

/** Parses a browser data URL ("data:image/jpeg;base64,...") into raw image bytes. */
export function parseDataUrl(dataUrl: unknown): ImageInput {
  if (typeof dataUrl !== 'string') throw new ValidationError('Each image must be a data URL string.');
  const match = DATA_URL.exec(dataUrl);
  if (!match) throw new ValidationError('Image is not a base64 data URL.');
  const [, mimeType, base64] = match as unknown as [string, string, string];
  if (!(IMAGE_MIME_TYPES as readonly string[]).includes(mimeType)) {
    throw new ValidationError(`Unsupported image type ${mimeType}. Use JPEG, PNG or WebP.`);
  }
  const data = Buffer.from(base64, 'base64');
  if (data.length === 0) throw new ValidationError('Image is empty.');
  if (data.length > IMAGE_LIMITS.maxBytesPerImage) throw new ValidationError('Image is too large.');
  return { mimeType: mimeType as ImageMimeType, data };
}

export function parseImageList(images: unknown): ImageInput[] {
  if (!Array.isArray(images) || images.length === 0) throw new ValidationError('Send at least one image.');
  if (images.length > IMAGE_LIMITS.maxImages) {
    throw new ValidationError(`Send at most ${IMAGE_LIMITS.maxImages} images at once.`);
  }
  return images.map(parseDataUrl);
}
