/**
 * Image preparation: validates decodability and produces the existing
 * optimized WebP variant (max width 800, quality 80) through the shared
 * optimizer.
 */

import { optimizeImage, type OptimizedImage } from "../blob/optimize";
import { sha256Hex } from "../migration/checksum";
import { extensionForMime, type OptimizerIdentity } from "../migration/versioning";
import type { DownloadedSourceImage } from "./download";

export const MAX_SOURCE_PIXELS = 60_000_000;

export class ImagePreparationError extends Error {}

export interface PreparedImage {
  original: {
    buffer: Buffer;
    contentType: string;
    sha256: string;
    sizeBytes: number;
    width: number;
    height: number;
    extension: string;
  };
  optimized: {
    buffer: Buffer;
    contentType: "image/webp";
    sha256: string;
    sizeBytes: number;
    width: number;
    height: number;
  };
  optimizer: OptimizerIdentity;
  sourceWidth: number;
  sourceHeight: number;
}

export interface PrepareImageOptions {
  optimizer: OptimizerIdentity;
  maxWidth?: number;
  quality?: number;
}

export async function prepareImage(
  downloaded: DownloadedSourceImage,
  options: PrepareImageOptions,
): Promise<PreparedImage> {
  let optimized: OptimizedImage;

  try {
    optimized = await optimizeImage(downloaded.buffer, {
      maxWidth: options.maxWidth,
      quality: options.quality,
    });
  } catch (error) {
    throw new ImagePreparationError(
      `image could not be decoded or optimized: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (
    !optimized.sourceWidth ||
    !optimized.sourceHeight ||
    optimized.sourceWidth * optimized.sourceHeight > MAX_SOURCE_PIXELS
  ) {
    throw new ImagePreparationError(
      `image dimensions are invalid or exceed ${MAX_SOURCE_PIXELS} pixels`,
    );
  }

  if (!optimized.width || !optimized.height || optimized.buffer.length === 0) {
    throw new ImagePreparationError("optimized image is empty");
  }

  return {
    original: {
      buffer: downloaded.buffer,
      contentType: downloaded.contentType,
      sha256: downloaded.sha256,
      sizeBytes: downloaded.sizeBytes,
      width: optimized.sourceWidth,
      height: optimized.sourceHeight,
      extension: extensionForMime(downloaded.contentType),
    },
    optimized: {
      buffer: optimized.buffer,
      contentType: "image/webp",
      sha256: sha256Hex(optimized.buffer),
      sizeBytes: optimized.buffer.length,
      width: optimized.width,
      height: optimized.height,
    },
    optimizer: options.optimizer,
    sourceWidth: optimized.sourceWidth,
    sourceHeight: optimized.sourceHeight,
  };
}
