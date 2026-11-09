export type SourceProvider = "raindrop-file" | "pbs-twimg";
export type IdentityConfidence = "high" | "medium" | "low" | "none";
export type ManifestMigrationStatus =
  "READY_TO_COPY" | "READY_WITH_REVIEW" | "SOURCE_UNAVAILABLE" | "INVALID_OR_MISSING";

export interface ManifestEntry {
  cineprintPosterId: string;
  notionPageId: string;
  notionTitle: string;
  notionDerivedId: string | null;
  identityReconciled: boolean;
  raindropId: string | null;
  raindropCollectionId: number | null;
  raindropBookmarkTitle: string | null;
  raindropBookmarkTags: string[];
  sourcePageUrl: string | null;
  sourceProvider: SourceProvider;
  sourceImageUrl: string | null;
  sourceAvailability: "available" | "unavailable" | "unknown";
  sourceHttpStatus: number | null;
  sourceMimeType: string | null;
  sourceDimensions: { width: number; height: number } | null;
  sourceSizeBytes: number | null;
  sourceSha256: string | null;
  sourceMatchesExistingOriginal: boolean | null;
  sourceExistingOriginalSizeDelta: number | null;
  currentImageUrl: string;
  currentImageProvider: "vercel-blob" | "external" | "unknown";
  currentImageObjectKey: string | null;
  originalR2Key: string | null;
  optimizedR2Key: string | null;
  existingOriginalObject: {
    path: string | null;
    exists: boolean;
    sizeBytes: number | null;
    mimeType: string | null;
  };
  existingOptimizedObject: {
    path: string | null;
    exists: boolean;
    sizeBytes: number | null;
    mimeType: string | null;
  };
  optimizedAction: "reuse-existing" | "regenerate";
  optimizedCurrentlyUnused: boolean;
  identityMatchMethod: string;
  identityConfidence: IdentityConfidence;
  migrationStatus: ManifestMigrationStatus;
  verificationNotes: string;
}

export interface PosterManifest {
  schemaVersion: number;
  generatedAt: string;
  baselineCommit: string;
  sourceCommit: string;
  counts: Record<string, number>;
  coverage: Record<string, string>;
  sourceProviders: Record<string, number>;
  identityMethods: Record<string, number>;
  migrationStatusCounts: Record<string, number>;
  duplicates: Record<string, Array<{ key: string; ids: string[] }>>;
  ambiguities: Array<Record<string, unknown>>;
  multiImagePages: Array<Record<string, unknown>>;
  optimized: Record<string, unknown>;
  dryRunValidation?: Record<string, unknown>;
  entries: ManifestEntry[];
}

export type MigrationStateName =
  | "PENDING"
  | "SOURCE_DOWNLOADED"
  | "SOURCE_VERIFIED"
  | "OPTIMIZED"
  | "READY_TO_UPLOAD"
  | "ORIGINAL_UPLOADED"
  | "OPTIMIZED_UPLOADED"
  | "VERIFIED"
  | "SOURCE_UNAVAILABLE"
  | "SOURCE_CHANGED"
  | "CONFLICT"
  | "FAILED"
  | "READY_WITH_REVIEW";

export interface MigrationStateEntry {
  posterId: string;
  state: MigrationStateName;
  attempts: number;
  lastError: string | null;
  updatedAt: string;
  sourceSha256: string | null;
  originalSha256: string | null;
  optimizedSha256: string | null;
  originalKey: string | null;
  optimizedKey: string | null;
  originalSizeBytes: number | null;
  optimizedSizeBytes: number | null;
  originalDimensions: { width: number; height: number } | null;
  optimizedDimensions: { width: number; height: number } | null;
  originalUploaded: boolean;
  optimizedUploaded: boolean;
  verifiedAt: string | null;
}

export interface MigrationState {
  schemaVersion: number;
  manifestHash: string;
  createdAt: string;
  updatedAt: string;
  entries: Record<string, MigrationStateEntry>;
}

export interface SourceDownload {
  buffer: Buffer;
  sha256: string;
  mimeType: string;
  dimensions: { width: number; height: number };
  sizeBytes: number;
  finalUrl: string;
  /** Final HTTP status when the downloader observed one. */
  httpStatus?: number;
}

export interface OptimizedImage {
  buffer: Buffer;
  contentType: "image/webp";
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  sha256: string;
  sizeBytes: number;
}

export interface R2ObjectMetadata {
  key: string;
  size: number;
  contentType: string | null;
  cacheControl: string | null;
  checksumSha256: string | null;
  metadataSha256: string | null;
  /** Lower-cased S3/R2 user metadata, when the store exposes it. */
  userMetadata?: Record<string, string> | null;
  etag: string | null;
}

export interface R2PutOptions {
  key: string;
  body: Buffer;
  contentType: string;
  cacheControl: string;
  metadata: Record<string, string>;
  sha256: string;
}

export interface R2Verification {
  ok: boolean;
  metadata: R2ObjectMetadata | null;
  reason: string | null;
}

export interface R2OriginVerification {
  ok: boolean;
  exists: boolean;
  checksumOk: boolean;
  metadataOk: boolean;
  sizeOk: boolean;
  metadata: R2ObjectMetadata | null;
  sha256: string | null;
  sizeBytes: number | null;
  reason: string | null;
}

export interface PublicVerification {
  ok: boolean;
  status: number;
  contentType: string | null;
  contentLength: number | null;
  cacheControl?: string | null;
  sha256: string | null;
  reason: string | null;
}

export interface R2ObjectExpectation {
  sha256: string;
  sizeBytes: number;
  contentType: string;
  cacheControl: string;
  userMetadata?: Record<string, string>;
}

export interface R2Store {
  head(key: string, options?: { signal?: AbortSignal }): Promise<R2ObjectMetadata | null>;
  verifyOrigin(key: string, expected: R2ObjectExpectation): Promise<R2OriginVerification>;
  put(options: R2PutOptions): Promise<void>;
  verify(key: string, expected: R2ObjectExpectation): Promise<R2Verification>;
  publicVerify(
    url: string,
    expected?: {
      sha256: string;
      sizeBytes: number;
      contentType: string;
      cacheControl?: string;
    },
  ): Promise<PublicVerification>;
}

export interface SourceDownloaderLike {
  download(entry: ManifestEntry): Promise<SourceDownload>;
}

export interface OptimizerLike {
  optimize(buffer: Buffer): Promise<OptimizedImage>;
}

export interface MigrationResult {
  posterId: string;
  state: MigrationStateName;
  message: string;
  source?: {
    sha256: string;
    mimeType: string;
    sizeBytes: number;
    dimensions: { width: number; height: number };
  };
  optimized?: {
    sha256: string;
    sizeBytes: number;
    dimensions: { width: number; height: number };
  };
  original?: {
    key: string;
    uploaded: boolean;
    alreadyVerified: boolean;
  };
  optimizedVariant?: {
    key: string;
    uploaded: boolean;
    alreadyVerified: boolean;
  };
  publicUrls?: {
    original: string;
    optimized: string;
  };
}

export interface CanaryPlanItem {
  posterId: string;
  provider: SourceProvider;
  originalKey: string;
  optimizedKey: string;
  optimizedAction: "reuse-existing" | "regenerate";
  identityConfidence: IdentityConfidence;
  blocked: boolean;
  blockedReason: string | null;
}
