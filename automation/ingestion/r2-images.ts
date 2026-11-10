/**
 * R2 image publishing for newly discovered posters.
 *
 * Reuses the migration store, key conventions, cache policy and verification
 * primitives. Objects are immutable: deterministic versioned keys plus
 * `If-None-Match` mean a retry can never overwrite verified bytes.
 */

import type { Logger } from "./logger";
import { R2_CACHE_CONTROL, R2ConflictError, R2UploadError } from "../migration/r2";
import type { R2ObjectExpectation, R2Store } from "../migration/types";
import {
  normalizePublicBaseUrl,
  R2_PUBLIC_BASE_URL,
  assertSafeR2Key,
} from "../migration/runtime-map";
import {
  DEFAULT_VERSIONED_QUALITY,
  DEFAULT_VERSIONED_WIDTH,
  optimizedVersionKey,
  originalVersionKey,
  type OptimizerIdentity,
} from "../migration/versioning";
import type { IngestionImageReferences } from "./types";

export interface PlannedR2Keys {
  sourceSha256: string;
  originalKey: string;
  optimizedKey: string;
  originalUrl: string;
  optimizedUrl: string;
}

export interface R2ImagePublisherOptions {
  store: R2Store;
  publicBaseUrl?: string;
  optimizer: OptimizerIdentity;
  width?: number;
  quality?: number;
  logger?: Logger;
  now?: () => Date;
}

export interface PublishableImage {
  original: {
    buffer: Buffer;
    contentType: string;
    sha256: string;
    sizeBytes: number;
    extension: string;
  };
  optimized: {
    buffer: Buffer;
    contentType: "image/webp";
    sha256: string;
    sizeBytes: number;
  };
}

export function planR2Keys(
  posterId: string,
  image: Pick<PublishableImage, "original">,
  optimizer: OptimizerIdentity,
  options: { publicBaseUrl?: string; width?: number; quality?: number } = {},
): PlannedR2Keys {
  const base = normalizePublicBaseUrl(options.publicBaseUrl ?? R2_PUBLIC_BASE_URL);
  const width = options.width ?? DEFAULT_VERSIONED_WIDTH;
  const quality = options.quality ?? DEFAULT_VERSIONED_QUALITY;

  const originalKey = originalVersionKey(posterId, image.original.sha256, image.original.extension);
  const optimizedKey = optimizedVersionKey(
    posterId,
    image.original.sha256,
    optimizer,
    width,
    quality,
  );

  assertSafeR2Key(originalKey, "original");
  assertSafeR2Key(optimizedKey, "optimized");

  return {
    sourceSha256: image.original.sha256,
    originalKey,
    optimizedKey,
    originalUrl: `${base}/${originalKey}`,
    optimizedUrl: `${base}/${optimizedKey}`,
  };
}

export class R2ImagePublisher {
  private readonly store: R2Store;
  private readonly publicBaseUrl: string;
  private readonly optimizer: OptimizerIdentity;
  private readonly width: number;
  private readonly quality: number;
  private readonly logger?: Logger;
  private readonly now: () => Date;

  constructor(options: R2ImagePublisherOptions) {
    this.store = options.store;
    this.publicBaseUrl = normalizePublicBaseUrl(options.publicBaseUrl ?? R2_PUBLIC_BASE_URL);
    this.optimizer = options.optimizer;
    this.width = options.width ?? DEFAULT_VERSIONED_WIDTH;
    this.quality = options.quality ?? DEFAULT_VERSIONED_QUALITY;
    this.logger = options.logger;
    this.now = options.now ?? (() => new Date());
  }

  async publish(
    posterId: string,
    image: PublishableImage,
    raindropId: string,
  ): Promise<IngestionImageReferences> {
    const keys = planR2Keys(posterId, image, this.optimizer, {
      publicBaseUrl: this.publicBaseUrl,
      width: this.width,
      quality: this.quality,
    });

    await this.ensureObject({
      posterId,
      raindropId,
      key: keys.originalKey,
      url: keys.originalUrl,
      body: image.original.buffer,
      contentType: image.original.contentType,
      sha256: image.original.sha256,
      sizeBytes: image.original.sizeBytes,
      role: "original",
    });

    await this.ensureObject({
      posterId,
      raindropId,
      key: keys.optimizedKey,
      url: keys.optimizedUrl,
      body: image.optimized.buffer,
      contentType: image.optimized.contentType,
      sha256: image.optimized.sha256,
      sizeBytes: image.optimized.sizeBytes,
      role: "optimized",
    });

    return {
      sourceSha256: keys.sourceSha256,
      original: {
        key: keys.originalKey,
        url: keys.originalUrl,
        sha256: image.original.sha256,
        sizeBytes: image.original.sizeBytes,
        contentType: image.original.contentType,
      },
      optimized: {
        key: keys.optimizedKey,
        url: keys.optimizedUrl,
        sha256: image.optimized.sha256,
        sizeBytes: image.optimized.sizeBytes,
        contentType: "image/webp",
      },
      verifiedAt: this.now().toISOString(),
    };
  }

  private expectation(input: {
    posterId: string;
    raindropId: string;
    contentType: string;
    sha256: string;
    sizeBytes: number;
    role: "original" | "optimized";
  }): R2ObjectExpectation {
    return {
      sha256: input.sha256,
      sizeBytes: input.sizeBytes,
      contentType: input.contentType,
      cacheControl: R2_CACHE_CONTROL,
      userMetadata: {
        sha256: input.sha256,
        posterid: input.posterId,
        raindropid: input.raindropId,
        role: input.role,
      },
    };
  }

  private async ensureObject(input: {
    posterId: string;
    raindropId: string;
    key: string;
    url: string;
    body: Buffer;
    contentType: string;
    sha256: string;
    sizeBytes: number;
    role: "original" | "optimized";
  }): Promise<"uploaded" | "reused"> {
    const expected = this.expectation(input);

    const existing = await this.store.head(input.key);
    if (existing) {
      const metadataVerified = await this.store.verify(input.key, expected);
      if (!metadataVerified.ok) {
        throw new R2UploadError(
          `Existing R2 object ${input.key} does not match the expected bytes: ${
            metadataVerified.reason ?? "unknown reason"
          }`,
          false,
        );
      }
      await this.assertVerified(input, expected);
      this.logger?.info("r2.object_reused", { key: input.key, role: input.role });
      return "reused";
    }

    try {
      await this.store.put({
        key: input.key,
        body: input.body,
        contentType: input.contentType,
        cacheControl: R2_CACHE_CONTROL,
        metadata: {
          sha256: input.sha256,
          posterid: input.posterId,
          raindropid: input.raindropId,
          role: input.role,
        },
        sha256: input.sha256,
      });
    } catch (error) {
      if (error instanceof R2ConflictError) {
        await this.assertVerified(input, expected);
        this.logger?.info("r2.object_conflict_resolved", { key: input.key, role: input.role });
        return "reused";
      }
      // The upload may have succeeded before the failure was observed. Verify
      // fully before reporting failure so a retry never re-uploads blindly.
      try {
        await this.assertVerified(input, expected);
      } catch {
        throw error;
      }
      this.logger?.info("r2.object_verified_after_error", {
        key: input.key,
        role: input.role,
      });
      return "reused";
    }

    await this.assertVerified(input, expected);
    this.logger?.info("r2.object_verified", { key: input.key, role: input.role });
    return "uploaded";
  }

  private async assertVerified(
    input: {
      key: string;
      url: string;
      contentType: string;
      sha256: string;
      sizeBytes: number;
    },
    expected: R2ObjectExpectation,
  ): Promise<void> {
    const origin = await this.store.verifyOrigin(input.key, expected);
    if (!origin.ok) {
      throw new R2UploadError(
        `R2 origin verification failed for ${input.key}: ${origin.reason ?? "unknown reason"}`,
        true,
      );
    }

    const published = await this.store.publicVerify(input.url, {
      sha256: input.sha256,
      sizeBytes: input.sizeBytes,
      contentType: input.contentType,
      cacheControl: R2_CACHE_CONTROL,
    });
    if (!published.ok) {
      throw new R2UploadError(
        `R2 public verification failed for ${input.key}: ${published.reason ?? "unknown reason"}`,
        true,
      );
    }
  }
}
