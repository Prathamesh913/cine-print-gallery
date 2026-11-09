import {
  DEFAULT_OPTIMIZE_WIDTH,
  DEFAULT_WEBP_QUALITY,
  isWebpBuffer,
  optimizeImage,
} from "../blob/optimize";
import { sha256Hex } from "./checksum";
import type { OptimizedImage, OptimizerLike } from "./types";

export class MigrationOptimizationError extends Error {}

export interface MigrationOptimizerOptions {
  maxWidth?: number;
  quality?: number;
}

export class MigrationOptimizer implements OptimizerLike {
  private readonly maxWidth: number;
  private readonly quality: number;

  constructor(options: MigrationOptimizerOptions = {}) {
    this.maxWidth = options.maxWidth ?? DEFAULT_OPTIMIZE_WIDTH;
    this.quality = options.quality ?? DEFAULT_WEBP_QUALITY;
  }

  async optimize(buffer: Buffer): Promise<OptimizedImage> {
    if (!buffer || buffer.length === 0) {
      throw new MigrationOptimizationError("Cannot optimize an empty buffer");
    }

    let result: Awaited<ReturnType<typeof optimizeImage>>;
    try {
      result = await optimizeImage(buffer, {
        maxWidth: this.maxWidth,
        quality: this.quality,
      });
    } catch (error) {
      throw new MigrationOptimizationError(
        `WebP optimization failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (!isWebpBuffer(result.buffer)) {
      throw new MigrationOptimizationError("Optimizer did not produce a valid WebP buffer");
    }
    if (!result.width || !result.height) {
      throw new MigrationOptimizationError("Optimized image dimensions are unavailable");
    }
    if (result.width > this.maxWidth) {
      throw new MigrationOptimizationError(
        `Optimized width ${result.width} exceeds the configured maximum ${this.maxWidth}`,
      );
    }

    return {
      buffer: result.buffer,
      contentType: "image/webp",
      width: result.width,
      height: result.height,
      sourceWidth: result.sourceWidth,
      sourceHeight: result.sourceHeight,
      sha256: sha256Hex(result.buffer),
      sizeBytes: result.buffer.length,
    };
  }
}

export function assertOptimizedDimensions(
  source: { width: number; height: number },
  optimized: { width: number; height: number },
  maxWidth = DEFAULT_OPTIMIZE_WIDTH,
): void {
  if (optimized.width > source.width && source.width <= maxWidth) {
    throw new MigrationOptimizationError("Optimizer upscaled an image that should not be upscaled");
  }
  const sourceRatio = source.width / source.height;
  const optimizedRatio = optimized.width / optimized.height;
  if (Math.abs(sourceRatio - optimizedRatio) > 0.01) {
    throw new MigrationOptimizationError(
      `Aspect ratio changed during optimization: ${sourceRatio.toFixed(4)} -> ${optimizedRatio.toFixed(4)}`,
    );
  }
}
