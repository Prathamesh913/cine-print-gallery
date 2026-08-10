import sharp from "sharp";

export const DEFAULT_OPTIMIZE_WIDTH = 800;
export const DEFAULT_WEBP_QUALITY = 80;
export const WEBP_CONTENT_TYPE = "image/webp";

export interface OptimizeImageOptions {
  maxWidth?: number;
  quality?: number;
}

export interface OptimizedImage {
  buffer: Buffer;
  contentType: typeof WEBP_CONTENT_TYPE;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
}

export class ImageOptimizationError extends Error {}

export function isWebpBuffer(buffer: Buffer): boolean {
  return (
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  );
}

export async function optimizeImage(
  input: Buffer,
  options: OptimizeImageOptions = {},
): Promise<OptimizedImage> {
  if (!input || input.length === 0) {
    throw new ImageOptimizationError("image buffer must be non-empty");
  }

  const maxWidth = options.maxWidth ?? DEFAULT_OPTIMIZE_WIDTH;
  const quality = options.quality ?? DEFAULT_WEBP_QUALITY;

  if (!Number.isInteger(maxWidth) || maxWidth < 1) {
    throw new ImageOptimizationError("maxWidth must be a positive integer");
  }

  if (!Number.isInteger(quality) || quality < 1 || quality > 100) {
    throw new ImageOptimizationError("quality must be an integer between 1 and 100");
  }

  try {
    const source = sharp(input);
    const metadata = await source.metadata();

    if (!metadata.width || !metadata.height) {
      throw new ImageOptimizationError("image dimensions are unavailable");
    }

    const output = await source
      .resize({ width: maxWidth, withoutEnlargement: true })
      .webp({ quality })
      .toBuffer({ resolveWithObject: true });

    if (!output.data.length || !isWebpBuffer(output.data)) {
      throw new ImageOptimizationError("optimizer did not produce a valid WebP");
    }

    return {
      buffer: output.data,
      contentType: WEBP_CONTENT_TYPE,
      width: output.info.width,
      height: output.info.height,
      sourceWidth: metadata.width,
      sourceHeight: metadata.height,
    };
  } catch (error) {
    if (error instanceof ImageOptimizationError) {
      throw error;
    }
    throw new ImageOptimizationError(error instanceof Error ? error.message : String(error));
  }
}
