import { blockedReason, publicUrl } from "./manifest";
import { buildCanaryPlan as buildPlan } from "./canary";
import type { Approvals } from "./manifest";
import { assertOptimizedDimensions } from "./optimize";
import { RetryExhaustedError, withRetry, isRetryableHttpStatus } from "./retry";
import { base64ToHex } from "./checksum";
import {
  R2_CACHE_CONTROL,
  R2ConflictError,
  R2Error,
  R2UploadError,
  R2UploadUnknownError,
  R2VerificationError,
  validateObjectMetadata,
} from "./r2";
import {
  isRetryableSourceError,
  redactSecrets,
  SourceChangedError,
  SourceHttpStatusError,
  SourceUnavailableError,
} from "./source";
import type {
  CanaryPlanItem,
  ManifestEntry,
  MigrationResult,
  MigrationStateName,
  OptimizerLike,
  PosterManifest,
  PublicVerification,
  R2ObjectMetadata,
  R2Store,
  SourceDownload,
  SourceDownloaderLike,
} from "./types";
import { validateVerifiedStateEntry, type MigrationStateStore } from "./state";
import { classifyFailure, MigrationObservabilityError } from "./failures";
import type { MigrationEventSink, ObserverEventDraft } from "./observer";

export interface EngineOptions {
  manifest: PosterManifest;
  stateStore: MigrationStateStore;
  downloader: SourceDownloaderLike;
  optimizer: OptimizerLike;
  r2: R2Store;
  approvals: Approvals;
  concurrency?: number;
  execute?: boolean;
  retryConflicts?: boolean;
  retrySourceChanged?: boolean;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
  publicRetryAttempts?: number;
  publicRetryBaseDelayMs?: number;
  publicRetryMaxDelayMs?: number;
  publicBaseUrl?: string;
  logger?: (message: string) => void;
  /** Optional structured observability sink. Defaults to no-op. */
  eventSink?: MigrationEventSink;
}

export interface InspectionResult {
  posterId: string;
  blocked: boolean;
  blockedReason: string | null;
  originalStatus: "MISSING" | "ALREADY_VERIFIED" | "CONFLICT" | "ERROR";
  optimizedStatus: "MISSING" | "PRESENT" | "CONFLICT" | "ERROR";
  originalHead: R2ObjectMetadata | null;
  optimizedHead: R2ObjectMetadata | null;
  message: string;
}

export interface VerificationResult {
  posterId: string;
  original: {
    exists: boolean;
    metadataVerified: boolean;
    expectedChecksumAvailable: boolean;
    originChecksumVerified: boolean;
    publicResponds: boolean;
    publicChecksumVerified: boolean;
    /** Alias for originChecksumVerified. */
    checksumVerified: boolean;
    /** Alias for publicChecksumVerified. */
    publicVerified: boolean;
    reason: string | null;
  };
  optimized: {
    exists: boolean;
    metadataVerified: boolean;
    expectedChecksumAvailable: boolean;
    originChecksumVerified: boolean;
    publicResponds: boolean;
    publicChecksumVerified: boolean;
    /** Alias for originChecksumVerified. */
    checksumVerified: boolean;
    /** Alias for publicChecksumVerified. */
    publicVerified: boolean;
    reason: string | null;
  };
}

export interface CanaryResult {
  plan: CanaryPlanItem[];
  results: MigrationResult[];
}

export class MigrationEngine {
  private readonly manifest: PosterManifest;
  private readonly stateStore: MigrationStateStore;
  private readonly downloader: SourceDownloaderLike;
  private readonly optimizer: OptimizerLike;
  private readonly r2: R2Store;
  private readonly approvals: Approvals;
  private readonly concurrency: number;
  private readonly execute: boolean;
  private readonly retryConflicts: boolean;
  private readonly retrySourceChanged: boolean;
  private readonly retryBaseDelayMs: number;
  private readonly retryMaxDelayMs: number;
  private readonly publicRetryAttempts: number;
  private readonly publicRetryBaseDelayMs: number;
  private readonly publicRetryMaxDelayMs: number;
  private readonly publicBaseUrl: string;
  private readonly logger: (message: string) => void;
  private readonly eventSink?: MigrationEventSink;

  constructor(options: EngineOptions) {
    this.manifest = options.manifest;
    this.stateStore = options.stateStore;
    this.downloader = options.downloader;
    this.optimizer = options.optimizer;
    this.r2 = options.r2;
    this.approvals = options.approvals;
    this.concurrency = Math.max(1, Math.min(8, options.concurrency ?? 3));
    this.execute = options.execute ?? false;
    this.retryConflicts = options.retryConflicts ?? false;
    this.retrySourceChanged = options.retrySourceChanged ?? false;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 500;
    this.retryMaxDelayMs = options.retryMaxDelayMs ?? 8_000;
    this.publicRetryAttempts = Math.max(1, options.publicRetryAttempts ?? 5);
    this.publicRetryBaseDelayMs = options.publicRetryBaseDelayMs ?? 1_000;
    this.publicRetryMaxDelayMs = options.publicRetryMaxDelayMs ?? 10_000;
    this.publicBaseUrl = (options.publicBaseUrl ?? "https://images.cineprint.click").replace(
      /\/+$/,
      "",
    );
    this.logger = options.logger ?? ((message) => console.log(message));
    this.eventSink = options.eventSink;
  }

  private emit(draft: ObserverEventDraft, originalError?: unknown): void {
    try {
      this.eventSink?.record(draft);
    } catch (observabilityError) {
      if (originalError !== undefined) {
        throw new MigrationObservabilityError(originalError, observabilityError);
      }
      throw observabilityError;
    }
  }

  private log(message: string): void {
    this.logger(redactSecrets(message));
  }

  private async saveState(): Promise<void> {
    try {
      await this.stateStore.save();
      this.emit({
        type: "state.checkpoint.written",
        outcome: "written",
        operation: "state.save",
      });
      this.eventSink?.checkpoint();
    } catch (error) {
      this.emit(
        {
          type: "state.checkpoint.rejected",
          outcome: "rejected",
          operation: "state.save",
          failureCategory: "STATE_PERSISTENCE_FAILED",
          retryable: false,
          message: error instanceof Error ? error.message : String(error),
        },
        error,
      );
      throw error;
    }
  }

  private isRetryableError(error: unknown): boolean {
    if (
      error instanceof SourceChangedError ||
      error instanceof R2ConflictError ||
      error instanceof R2VerificationError ||
      error instanceof R2UploadUnknownError
    ) {
      return false;
    }
    if (error instanceof R2UploadError) return error.retryable;
    if (error instanceof SourceUnavailableError) return isRetryableSourceError(error);
    if (error instanceof R2Error) return false;
    const status = (error as { status?: number }).status;
    if (typeof status === "number") return isRetryableHttpStatus(status);
    return true;
  }

  private async downloadWithRetry(entry: ManifestEntry): Promise<SourceDownload> {
    const startedAt = Date.now();
    this.emit({
      type: "source.download.started",
      outcome: "started",
      posterId: entry.cineprintPosterId,
      operation: "source.download",
    });
    try {
      const download = await withRetry(() => this.downloader.download(entry), {
        attempts: 3,
        baseDelayMs: this.retryBaseDelayMs,
        maxDelayMs: this.retryMaxDelayMs,
        shouldRetry: (error) => this.isRetryableError(error),
        onRetry: (error, attempt) => {
          this.log(
            `Retrying source download for ${entry.cineprintPosterId} (attempt ${attempt + 1}): ${error instanceof Error ? error.message : String(error)}`,
          );
        },
      });
      this.emit({
        type: "source.download.completed",
        outcome: "completed",
        posterId: entry.cineprintPosterId,
        operation: "source.download",
        durationMs: Date.now() - startedAt,
        bytes: download.sizeBytes,
        observedSha256: download.sha256,
        ...(download.httpStatus !== undefined ? { httpStatus: download.httpStatus } : {}),
      });
      return download;
    } catch (error) {
      const cause = error instanceof RetryExhaustedError ? error.lastError : error;
      this.emit(
        {
          type: "source.download.failed",
          outcome: "failed",
          posterId: entry.cineprintPosterId,
          operation: "source.download",
          durationMs: Date.now() - startedAt,
          failureCategory: classifyFailure(cause),
          retryable: this.isRetryableError(cause),
          ...(cause instanceof SourceHttpStatusError ? { httpStatus: cause.status } : {}),
          message: cause instanceof Error ? cause.message : String(cause),
        },
        cause,
      );
      throw error;
    }
  }

  private async reconcileUpload(options: {
    key: string;
    body: Buffer;
    contentType: string;
    metadata: Record<string, string>;
    sha256: string;
  }): Promise<"match" | "mismatch" | "absent" | "unknown"> {
    const attempts = 3;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const verification = await this.r2.verifyOrigin(options.key, {
          sha256: options.sha256,
          sizeBytes: options.body.length,
          contentType: options.contentType,
          cacheControl: R2_CACHE_CONTROL,
          userMetadata: options.metadata,
        });
        if (verification.exists) {
          return verification.ok ? "match" : "mismatch";
        }
        if (attempt === attempts) return "absent";
      } catch {
        // Existence could not be established. Retry within the bounded budget.
      }
      if (attempt < attempts) {
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(250, this.retryBaseDelayMs) * attempt),
        );
      }
    }
    return "unknown";
  }

  /**
   * Create-only upload with bounded read-back reconciliation. A lost response or
   * a 412 is never resolved by overwriting: the engine reads the object back and
   * accepts it only when every expected byte and metadata field matches.
   */
  private async uploadWithReconciliation(options: {
    key: string;
    body: Buffer;
    contentType: string;
    metadata: Record<string, string>;
    sha256: string;
  }): Promise<{ uploaded: boolean; alreadyVerified: boolean; reconciled: boolean }> {
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.r2.put({
          key: options.key,
          body: options.body,
          contentType: options.contentType,
          cacheControl: R2_CACHE_CONTROL,
          metadata: options.metadata,
          sha256: options.sha256,
        });
        return { uploaded: true, alreadyVerified: false, reconciled: false };
      } catch (error) {
        if (error instanceof R2ConflictError) {
          const outcome = await this.reconcileUpload(options);
          if (outcome === "match") {
            return { uploaded: false, alreadyVerified: true, reconciled: true };
          }
          if (outcome === "mismatch" || outcome === "absent") {
            // A 412 is a conclusive create-only refusal. If the object cannot
            // be seen yet, treat it as a conflict rather than guessing.
            throw new R2ConflictError(
              `Existing R2 object ${options.key} differs from the expected bytes or metadata; refusing to overwrite`,
            );
          }
          throw new R2UploadUnknownError(
            `R2 upload for ${options.key} conflicted and read-back was inconclusive; no overwrite attempted`,
          );
        }

        if (error instanceof R2UploadError && error.retryable) {
          const outcome = await this.reconcileUpload(options);
          if (outcome === "match") {
            return { uploaded: true, alreadyVerified: true, reconciled: true };
          }
          if (outcome === "mismatch") {
            throw new R2ConflictError(
              `R2 object ${options.key} exists after an ambiguous upload but differs from the expected bytes or metadata`,
            );
          }
          if (outcome === "absent" && attempt < maxAttempts) {
            this.log(
              `Retrying R2 upload for ${options.key} after an ambiguous failure (attempt ${attempt + 1})`,
            );
            await new Promise((resolve) =>
              setTimeout(resolve, Math.min(this.retryMaxDelayMs, this.retryBaseDelayMs * attempt)),
            );
            continue;
          }
          throw new R2UploadUnknownError(
            `R2 upload outcome for ${options.key} could not be established after bounded read-back; no overwrite attempted`,
          );
        }

        if (error instanceof R2UploadError) {
          throw new RetryExhaustedError(
            `Operation failed after 1 attempt(s): ${error.message}`,
            error,
          );
        }
        throw error;
      }
    }

    throw new R2UploadUnknownError(
      `R2 upload outcome for ${options.key} was not established within the attempt budget`,
    );
  }

  private isRetryablePublicFailure(result: PublicVerification): boolean {
    if (result.ok) return false;
    if (result.status === 0) return true;
    if (result.status === 200) return true; // content/checksum mismatch can be transient CDN staleness
    if (
      result.status === 404 ||
      result.status === 408 ||
      result.status === 425 ||
      result.status === 429
    ) {
      return true;
    }
    return result.status >= 500;
  }

  private async publicVerifyWithRetry(
    url: string,
    expected?: { sha256: string; sizeBytes: number; contentType: string },
  ): Promise<PublicVerification> {
    let lastResult: PublicVerification | null = null;

    for (let attempt = 1; attempt <= this.publicRetryAttempts; attempt++) {
      lastResult = await this.r2.publicVerify(url, expected);
      if (lastResult.ok) return lastResult;

      if (attempt >= this.publicRetryAttempts || !this.isRetryablePublicFailure(lastResult)) {
        return lastResult;
      }

      const exponential = Math.min(
        this.publicRetryMaxDelayMs,
        this.publicRetryBaseDelayMs * 2 ** (attempt - 1),
      );
      const jitter = Math.floor(Math.random() * Math.max(1, Math.floor(exponential * 0.2)));
      await new Promise((resolve) => setTimeout(resolve, exponential + jitter));
    }

    return (
      lastResult ?? {
        ok: false,
        status: 0,
        contentType: null,
        contentLength: null,
        sha256: null,
        reason: "Public verification did not run",
      }
    );
  }

  private objectChecksum(head: R2ObjectMetadata): string | null {
    if (head.metadataSha256) return head.metadataSha256.toLowerCase();
    if (head.checksumSha256) return base64ToHex(head.checksumSha256);
    return null;
  }

  private async ensureObject(options: {
    key: string;
    body: Buffer;
    contentType: string;
    sha256: string;
    metadata: Record<string, string>;
    label: string;
  }): Promise<{ uploaded: boolean; alreadyVerified: boolean }> {
    const posterId = options.metadata["poster-id"];
    const variant =
      options.label === "original" || options.label === "optimized" ? options.label : undefined;
    const startedAt = Date.now();
    const existing = await this.r2.verifyOrigin(options.key, {
      sha256: options.sha256,
      sizeBytes: options.body.length,
      contentType: options.contentType,
      cacheControl: R2_CACHE_CONTROL,
      userMetadata: options.metadata,
    });

    if (existing.exists) {
      this.emit({
        type: "object.existing.discovered",
        outcome: "discovered",
        ...(posterId ? { posterId } : {}),
        ...(variant ? { variant } : {}),
        operation: "r2.upload",
        metadata: { key: options.key },
      });
      if (!existing.ok) {
        this.emit({
          type: "r2.upload.conflicted",
          outcome: "conflicted",
          ...(posterId ? { posterId } : {}),
          ...(variant ? { variant } : {}),
          operation: "r2.upload",
          failureCategory: "R2_CONFLICT",
          retryable: false,
          durationMs: Date.now() - startedAt,
          expectedSha256: options.sha256,
          ...(existing.sha256 ? { observedSha256: existing.sha256 } : {}),
          message: `Existing R2 object ${options.key} failed origin verification: ${existing.reason ?? "unknown"}`,
          metadata: { key: options.key },
        });
        throw new R2ConflictError(
          `Existing R2 object ${options.key} failed origin verification: ${existing.reason ?? "unknown"}`,
        );
      }
      this.emit({
        type: "object.existing.reconciled",
        outcome: "reconciled",
        ...(posterId ? { posterId } : {}),
        ...(variant ? { variant } : {}),
        operation: "r2.upload",
        durationMs: Date.now() - startedAt,
        expectedSha256: options.sha256,
        observedSha256: existing.sha256 ?? options.sha256,
        metadata: { key: options.key },
      });
      return { uploaded: false, alreadyVerified: true };
    }

    this.emit({
      type: "r2.upload.started",
      outcome: "started",
      ...(posterId ? { posterId } : {}),
      ...(variant ? { variant } : {}),
      operation: "r2.upload",
      bytes: options.body.length,
      expectedSha256: options.sha256,
      metadata: { key: options.key },
    });

    try {
      const outcome = await this.uploadWithReconciliation({
        key: options.key,
        body: options.body,
        contentType: options.contentType,
        metadata: options.metadata,
        sha256: options.sha256,
      });

      if (outcome.reconciled) {
        this.emit({
          type: "object.existing.reconciled",
          outcome: "reconciled",
          ...(posterId ? { posterId } : {}),
          ...(variant ? { variant } : {}),
          operation: "r2.upload",
          durationMs: Date.now() - startedAt,
          bytes: options.body.length,
          expectedSha256: options.sha256,
          observedSha256: options.sha256,
          metadata: { key: options.key },
        });
        return { uploaded: outcome.uploaded, alreadyVerified: true };
      }

      const verification = await this.r2.verifyOrigin(options.key, {
        sha256: options.sha256,
        sizeBytes: options.body.length,
        contentType: options.contentType,
        cacheControl: R2_CACHE_CONTROL,
        userMetadata: options.metadata,
      });
      if (!verification.ok) {
        this.emit({
          type: "r2.upload.completed",
          outcome: "failed",
          ...(posterId ? { posterId } : {}),
          ...(variant ? { variant } : {}),
          operation: "r2.upload",
          durationMs: Date.now() - startedAt,
          failureCategory: "ORIGIN_VERIFICATION_FAILED",
          retryable: false,
          expectedSha256: options.sha256,
          ...(verification.sha256 ? { observedSha256: verification.sha256 } : {}),
          message: verification.reason ?? "origin verification failed",
          metadata: { key: options.key },
        });
        throw new R2VerificationError(
          `R2 origin verification failed for ${options.label} ${options.key}: ${verification.reason ?? "unknown reason"}`,
        );
      }

      this.emit({
        type: "r2.upload.completed",
        outcome: "completed",
        ...(posterId ? { posterId } : {}),
        ...(variant ? { variant } : {}),
        operation: "r2.upload",
        durationMs: Date.now() - startedAt,
        bytes: options.body.length,
        expectedSha256: options.sha256,
        observedSha256: verification.sha256 ?? options.sha256,
        metadata: { key: options.key },
      });
      return { uploaded: outcome.uploaded, alreadyVerified: false };
    } catch (error) {
      if (!(error instanceof R2VerificationError)) {
        const category = classifyFailure(error);
        const eventType =
          category === "R2_AMBIGUOUS"
            ? "r2.upload.ambiguous"
            : category === "R2_CONFLICT"
              ? "r2.upload.conflicted"
              : "r2.upload.completed";
        const outcome =
          category === "R2_AMBIGUOUS"
            ? "ambiguous"
            : category === "R2_CONFLICT"
              ? "conflicted"
              : "failed";
        this.emit(
          {
            type: eventType,
            outcome,
            ...(posterId ? { posterId } : {}),
            ...(variant ? { variant } : {}),
            operation: "r2.upload",
            durationMs: Date.now() - startedAt,
            failureCategory: category,
            retryable: false,
            expectedSha256: options.sha256,
            message: error instanceof Error ? error.message : String(error),
            metadata: { key: options.key },
          },
          error,
        );
      }
      throw error;
    }
  }

  private async verifyBoth(
    entry: ManifestEntry,
    source: SourceDownload,
    optimized: { sha256: string; sizeBytes: number },
  ): Promise<{ originalPublic: boolean; optimizedPublic: boolean; reason: string | null }> {
    if (!entry.originalR2Key || !entry.optimizedR2Key) {
      return { originalPublic: false, optimizedPublic: false, reason: "Missing R2 keys" };
    }

    const originStarted = Date.now();
    this.emit({
      type: "origin.verification.started",
      outcome: "started",
      posterId: entry.cineprintPosterId,
      variant: "original",
      operation: "origin.verification",
    });
    const originalVerification = await this.r2.verifyOrigin(entry.originalR2Key, {
      sha256: source.sha256,
      sizeBytes: source.sizeBytes,
      contentType: source.mimeType,
      cacheControl: R2_CACHE_CONTROL,
    });
    this.emit(
      {
        type: "origin.verification.completed",
        outcome: originalVerification.ok ? "completed" : "failed",
        posterId: entry.cineprintPosterId,
        variant: "original",
        operation: "origin.verification",
        durationMs: Date.now() - originStarted,
        expectedSha256: source.sha256,
        metadata: { key: entry.originalR2Key },
        ...(originalVerification.sha256 ? { observedSha256: originalVerification.sha256 } : {}),
        ...(originalVerification.ok
          ? {}
          : { failureCategory: "ORIGIN_VERIFICATION_FAILED" as const, retryable: false }),
        ...(originalVerification.reason ? { message: originalVerification.reason } : {}),
      },
      new Error(originalVerification.reason ?? "Original verification failed"),
    );
    if (!originalVerification.ok) {
      return {
        originalPublic: false,
        optimizedPublic: false,
        reason: `Original verification failed: ${originalVerification.reason ?? "unknown"}`,
      };
    }

    this.emit({
      type: "origin.verification.started",
      outcome: "started",
      posterId: entry.cineprintPosterId,
      variant: "optimized",
      operation: "origin.verification",
    });
    const optimizedVerification = await this.r2.verifyOrigin(entry.optimizedR2Key, {
      sha256: optimized.sha256,
      sizeBytes: optimized.sizeBytes,
      contentType: "image/webp",
      cacheControl: R2_CACHE_CONTROL,
    });
    this.emit(
      {
        type: "origin.verification.completed",
        outcome: optimizedVerification.ok ? "completed" : "failed",
        posterId: entry.cineprintPosterId,
        variant: "optimized",
        operation: "origin.verification",
        durationMs: Date.now() - originStarted,
        expectedSha256: optimized.sha256,
        metadata: { key: entry.optimizedR2Key },
        ...(optimizedVerification.sha256 ? { observedSha256: optimizedVerification.sha256 } : {}),
        ...(optimizedVerification.ok
          ? {}
          : { failureCategory: "ORIGIN_VERIFICATION_FAILED" as const, retryable: false }),
        ...(optimizedVerification.reason ? { message: optimizedVerification.reason } : {}),
      },
      new Error(optimizedVerification.reason ?? "Optimized verification failed"),
    );
    if (!optimizedVerification.ok) {
      return {
        originalPublic: false,
        optimizedPublic: false,
        reason: `Optimized verification failed: ${optimizedVerification.reason ?? "unknown"}`,
      };
    }

    const cdnOriginalStarted = Date.now();
    this.emit({
      type: "cdn.verification.started",
      outcome: "started",
      posterId: entry.cineprintPosterId,
      variant: "original",
      operation: "cdn.verification",
    });
    const originalPublic = await this.publicVerifyWithRetry(
      publicUrl(this.publicBaseUrl, entry.originalR2Key),
      {
        sha256: source.sha256,
        sizeBytes: source.sizeBytes,
        contentType: source.mimeType,
      },
    );
    this.emit(
      {
        type: "cdn.verification.completed",
        outcome: originalPublic.ok ? "completed" : "failed",
        posterId: entry.cineprintPosterId,
        variant: "original",
        operation: "cdn.verification",
        durationMs: Date.now() - cdnOriginalStarted,
        ...(originalPublic.status ? { httpStatus: originalPublic.status } : {}),
        expectedSha256: source.sha256,
        metadata: { key: entry.originalR2Key },
        ...(originalPublic.sha256 ? { observedSha256: originalPublic.sha256 } : {}),
        ...(originalPublic.ok
          ? {}
          : { failureCategory: "CDN_VERIFICATION_FAILED" as const, retryable: true }),
        ...(originalPublic.reason ? { message: originalPublic.reason } : {}),
      },
      new Error(originalPublic.reason ?? "Original public verification failed"),
    );
    if (!originalPublic.ok) {
      return {
        originalPublic: false,
        optimizedPublic: false,
        reason: `Original public verification failed: ${originalPublic.reason ?? "unknown"}`,
      };
    }

    const cdnOptimizedStarted = Date.now();
    this.emit({
      type: "cdn.verification.started",
      outcome: "started",
      posterId: entry.cineprintPosterId,
      variant: "optimized",
      operation: "cdn.verification",
    });
    const optimizedPublic = await this.publicVerifyWithRetry(
      publicUrl(this.publicBaseUrl, entry.optimizedR2Key),
      {
        sha256: optimized.sha256,
        sizeBytes: optimized.sizeBytes,
        contentType: "image/webp",
      },
    );
    this.emit(
      {
        type: "cdn.verification.completed",
        outcome: optimizedPublic.ok ? "completed" : "failed",
        posterId: entry.cineprintPosterId,
        variant: "optimized",
        operation: "cdn.verification",
        durationMs: Date.now() - cdnOptimizedStarted,
        ...(optimizedPublic.status ? { httpStatus: optimizedPublic.status } : {}),
        expectedSha256: optimized.sha256,
        metadata: { key: entry.optimizedR2Key },
        ...(optimizedPublic.sha256 ? { observedSha256: optimizedPublic.sha256 } : {}),
        ...(optimizedPublic.ok
          ? {}
          : { failureCategory: "CDN_VERIFICATION_FAILED" as const, retryable: true }),
        ...(optimizedPublic.reason ? { message: optimizedPublic.reason } : {}),
      },
      new Error(optimizedPublic.reason ?? "Optimized public verification failed"),
    );
    if (!optimizedPublic.ok) {
      return {
        originalPublic: false,
        optimizedPublic: false,
        reason: `Optimized public verification failed: ${optimizedPublic.reason ?? "unknown"}`,
      };
    }

    return { originalPublic: true, optimizedPublic: true, reason: null };
  }

  private async revalidateVerifiedEntry(
    entry: ManifestEntry,
    state: NonNullable<ReturnType<MigrationStateStore["get"]>>,
  ): Promise<MigrationResult> {
    const errors = validateVerifiedStateEntry(state, {
      posterId: entry.cineprintPosterId,
      sourceSha256: entry.sourceSha256,
      originalKey: entry.originalR2Key,
      optimizedKey: entry.optimizedR2Key,
      sourceSizeBytes: entry.sourceSizeBytes,
      sourceDimensions: entry.sourceDimensions,
    });

    if (errors.length > 0) {
      const message = `Invalid VERIFIED state: ${errors.join("; ")}`;
      this.stateStore.update(entry.cineprintPosterId, { state: "FAILED", lastError: message });
      await this.saveState();
      return { posterId: entry.cineprintPosterId, state: "FAILED", message };
    }

    if (
      !entry.originalR2Key ||
      !entry.optimizedR2Key ||
      !entry.sourceMimeType ||
      !state.originalSha256 ||
      !state.optimizedSha256 ||
      state.originalSizeBytes === null ||
      state.optimizedSizeBytes === null
    ) {
      const message = "Invalid VERIFIED state: required verification fields are missing";
      this.stateStore.update(entry.cineprintPosterId, { state: "FAILED", lastError: message });
      await this.saveState();
      return { posterId: entry.cineprintPosterId, state: "FAILED", message };
    }

    try {
      const originalVerification = await this.r2.verifyOrigin(entry.originalR2Key, {
        sha256: state.originalSha256,
        sizeBytes: state.originalSizeBytes,
        contentType: entry.sourceMimeType,
        cacheControl: R2_CACHE_CONTROL,
      });
      if (!originalVerification.ok) {
        const message = `Previously VERIFIED original failed re-verification: ${originalVerification.reason ?? "unknown"}`;
        this.stateStore.update(entry.cineprintPosterId, { state: "CONFLICT", lastError: message });
        await this.saveState();
        return { posterId: entry.cineprintPosterId, state: "CONFLICT", message };
      }

      const optimizedVerification = await this.r2.verifyOrigin(entry.optimizedR2Key, {
        sha256: state.optimizedSha256,
        sizeBytes: state.optimizedSizeBytes,
        contentType: "image/webp",
        cacheControl: R2_CACHE_CONTROL,
      });
      if (!optimizedVerification.ok) {
        const message = `Previously VERIFIED optimized failed re-verification: ${optimizedVerification.reason ?? "unknown"}`;
        this.stateStore.update(entry.cineprintPosterId, { state: "CONFLICT", lastError: message });
        await this.saveState();
        return { posterId: entry.cineprintPosterId, state: "CONFLICT", message };
      }

      const originalPublic = await this.publicVerifyWithRetry(
        publicUrl(this.publicBaseUrl, entry.originalR2Key),
        {
          sha256: state.originalSha256,
          sizeBytes: state.originalSizeBytes,
          contentType: entry.sourceMimeType,
        },
      );
      if (!originalPublic.ok) {
        const message = `Previously VERIFIED original failed public verification: ${originalPublic.reason ?? "unknown"}`;
        this.stateStore.update(entry.cineprintPosterId, { state: "FAILED", lastError: message });
        await this.saveState();
        return { posterId: entry.cineprintPosterId, state: "FAILED", message };
      }

      const optimizedPublic = await this.publicVerifyWithRetry(
        publicUrl(this.publicBaseUrl, entry.optimizedR2Key),
        {
          sha256: state.optimizedSha256,
          sizeBytes: state.optimizedSizeBytes,
          contentType: "image/webp",
        },
      );
      if (!optimizedPublic.ok) {
        const message = `Previously VERIFIED optimized failed public verification: ${optimizedPublic.reason ?? "unknown"}`;
        this.stateStore.update(entry.cineprintPosterId, { state: "FAILED", lastError: message });
        await this.saveState();
        return { posterId: entry.cineprintPosterId, state: "FAILED", message };
      }

      return {
        posterId: entry.cineprintPosterId,
        state: "VERIFIED",
        message: "Re-verified existing state",
        publicUrls: {
          original: publicUrl(this.publicBaseUrl, entry.originalR2Key),
          optimized: publicUrl(this.publicBaseUrl, entry.optimizedR2Key),
        },
      };
    } catch (error) {
      const message = redactSecrets(error instanceof Error ? error.message : String(error));
      this.stateStore.update(entry.cineprintPosterId, { state: "FAILED", lastError: message });
      await this.saveState();
      return { posterId: entry.cineprintPosterId, state: "FAILED", message };
    }
  }

  async migrateEntry(entry: ManifestEntry): Promise<MigrationResult> {
    const startedAt = Date.now();
    this.eventSink?.beginPoster(entry.cineprintPosterId);
    this.emit({
      type: "poster.started",
      outcome: "started",
      posterId: entry.cineprintPosterId,
      operation: "poster",
    });
    try {
      const result = await this.migrateEntryInternal(entry);
      const verified = result.state === "VERIFIED";
      const failed =
        result.state === "FAILED" ||
        result.state === "CONFLICT" ||
        result.state === "SOURCE_CHANGED";
      this.emit({
        type: verified ? "poster.verified" : failed ? "poster.failed" : "poster.skipped",
        outcome: verified ? "verified" : failed ? "failed" : "skipped",
        posterId: entry.cineprintPosterId,
        operation: "poster",
        durationMs: Date.now() - startedAt,
        message: result.message,
      });
      return result;
    } catch (error) {
      this.emit(
        {
          type: "poster.failed",
          outcome: "failed",
          posterId: entry.cineprintPosterId,
          operation: "poster",
          durationMs: Date.now() - startedAt,
          failureCategory: classifyFailure(error),
          retryable: false,
          message: error instanceof Error ? error.message : String(error),
        },
        error,
      );
      throw error;
    } finally {
      this.eventSink?.endPoster();
    }
  }

  private async migrateEntryInternal(entry: ManifestEntry): Promise<MigrationResult> {
    if (!this.execute) {
      const inspection = await this.inspectEntry(entry);
      const state: MigrationStateName = inspection.blocked
        ? "READY_WITH_REVIEW"
        : inspection.originalStatus === "CONFLICT" || inspection.optimizedStatus === "CONFLICT"
          ? "CONFLICT"
          : inspection.originalStatus === "ALREADY_VERIFIED" &&
              inspection.optimizedStatus === "PRESENT"
            ? "VERIFIED"
            : "READY_TO_UPLOAD";
      return {
        posterId: entry.cineprintPosterId,
        state,
        message: inspection.message,
      };
    }

    const blocked = blockedReason(entry, this.approvals);
    if (blocked) {
      const state: MigrationStateName =
        entry.sourceAvailability !== "available" || entry.migrationStatus === "SOURCE_UNAVAILABLE"
          ? "SOURCE_UNAVAILABLE"
          : entry.migrationStatus === "INVALID_OR_MISSING"
            ? "FAILED"
            : "READY_WITH_REVIEW";
      this.stateStore.update(entry.cineprintPosterId, {
        state,
        lastError: blocked,
      });
      await this.saveState();
      return {
        posterId: entry.cineprintPosterId,
        state,
        message: blocked,
      };
    }

    const existingState = this.stateStore.get(entry.cineprintPosterId);
    if (existingState?.state === "VERIFIED") {
      return this.revalidateVerifiedEntry(entry, existingState);
    }
    if (existingState?.state === "CONFLICT" && !this.retryConflicts) {
      return {
        posterId: entry.cineprintPosterId,
        state: "CONFLICT",
        message: "Existing conflict requires review; use --retry-conflicts to retry",
      };
    }
    if (existingState?.state === "SOURCE_CHANGED" && !this.retrySourceChanged) {
      return {
        posterId: entry.cineprintPosterId,
        state: "SOURCE_CHANGED",
        message: "Source changed; use --retry-source-changed to retry",
      };
    }

    this.stateStore.update(entry.cineprintPosterId, {
      state: "PENDING",
      lastError: null,
      incrementAttempts: true,
    });
    await this.saveState();

    let source: SourceDownload;
    try {
      source = await this.downloadWithRetry(entry);
    } catch (error) {
      const originalError =
        error instanceof MigrationObservabilityError ? error.originalError : error;
      const cause =
        originalError instanceof RetryExhaustedError ? originalError.lastError : originalError;
      const state: MigrationStateName =
        cause instanceof SourceChangedError
          ? "SOURCE_CHANGED"
          : cause instanceof SourceUnavailableError
            ? "SOURCE_UNAVAILABLE"
            : "FAILED";
      const secondary =
        error instanceof MigrationObservabilityError
          ? `; observability failure: ${redactSecrets(
              error.observabilityError instanceof Error
                ? error.observabilityError.message
                : String(error.observabilityError),
            )}`
          : "";
      const message = `${redactSecrets(
        cause instanceof Error ? cause.message : String(cause),
      )}${secondary}`;
      this.stateStore.update(entry.cineprintPosterId, { state, lastError: message });
      await this.saveState();
      return { posterId: entry.cineprintPosterId, state, message };
    }

    this.stateStore.update(entry.cineprintPosterId, {
      state: "SOURCE_DOWNLOADED",
      sourceSha256: source.sha256,
      originalSha256: source.sha256,
      originalKey: entry.originalR2Key,
      originalSizeBytes: source.sizeBytes,
      originalDimensions: source.dimensions,
      lastError: null,
    });
    await this.saveState();

    if (entry.sourceSha256 && source.sha256 !== entry.sourceSha256) {
      const message = `Source checksum changed: expected ${entry.sourceSha256}, received ${source.sha256}`;
      this.emit({
        type: "source.checksum.changed",
        outcome: "changed",
        posterId: entry.cineprintPosterId,
        operation: "source.download",
        failureCategory: "SOURCE_CHANGED",
        retryable: false,
        expectedSha256: entry.sourceSha256,
        observedSha256: source.sha256,
        message,
      });
      this.stateStore.update(entry.cineprintPosterId, {
        state: "SOURCE_CHANGED",
        lastError: message,
      });
      await this.saveState();
      return { posterId: entry.cineprintPosterId, state: "SOURCE_CHANGED", message };
    }

    this.stateStore.update(entry.cineprintPosterId, {
      state: "SOURCE_VERIFIED",
      lastError: null,
    });
    await this.saveState();

    const optimizationStartedAt = Date.now();
    this.emit({
      type: "optimization.started",
      outcome: "started",
      posterId: entry.cineprintPosterId,
      operation: "optimization",
    });
    let optimized;
    try {
      optimized = await this.optimizer.optimize(source.buffer);
      assertOptimizedDimensions(
        { width: optimized.sourceWidth, height: optimized.sourceHeight },
        { width: optimized.width, height: optimized.height },
      );
      this.emit({
        type: "optimization.completed",
        outcome: "completed",
        posterId: entry.cineprintPosterId,
        operation: "optimization",
        durationMs: Date.now() - optimizationStartedAt,
        bytes: optimized.sizeBytes,
        observedSha256: optimized.sha256,
      });
    } catch (error) {
      const message = redactSecrets(error instanceof Error ? error.message : String(error));
      this.emit({
        type: "optimization.failed",
        outcome: "failed",
        posterId: entry.cineprintPosterId,
        operation: "optimization",
        durationMs: Date.now() - optimizationStartedAt,
        failureCategory: "OPTIMIZATION_FAILED",
        retryable: false,
        message,
      });
      this.stateStore.update(entry.cineprintPosterId, { state: "FAILED", lastError: message });
      await this.saveState();
      return { posterId: entry.cineprintPosterId, state: "FAILED", message };
    }

    this.stateStore.update(entry.cineprintPosterId, {
      state: "OPTIMIZED",
      optimizedSha256: optimized.sha256,
      optimizedKey: entry.optimizedR2Key,
      optimizedSizeBytes: optimized.sizeBytes,
      optimizedDimensions: { width: optimized.width, height: optimized.height },
      lastError: null,
    });
    await this.saveState();

    this.stateStore.update(entry.cineprintPosterId, {
      state: "READY_TO_UPLOAD",
      lastError: null,
    });
    await this.saveState();

    if (!entry.originalR2Key || !entry.optimizedR2Key) {
      const message = "Manifest entry is missing R2 object keys";
      this.stateStore.update(entry.cineprintPosterId, { state: "FAILED", lastError: message });
      await this.saveState();
      return { posterId: entry.cineprintPosterId, state: "FAILED", message };
    }

    try {
      const original = await this.ensureObject({
        key: entry.originalR2Key,
        body: source.buffer,
        contentType: source.mimeType,
        sha256: source.sha256,
        metadata: {
          sha256: source.sha256,
          "poster-id": entry.cineprintPosterId,
          variant: "original",
          "source-provider": entry.sourceProvider,
        },
        label: "original",
      });

      this.stateStore.update(entry.cineprintPosterId, {
        state: "ORIGINAL_UPLOADED",
        originalUploaded: true,
        lastError: null,
      });
      await this.saveState();

      const optimizedResult = await this.ensureObject({
        key: entry.optimizedR2Key,
        body: optimized.buffer,
        contentType: "image/webp",
        sha256: optimized.sha256,
        metadata: {
          sha256: optimized.sha256,
          "poster-id": entry.cineprintPosterId,
          variant: "optimized",
          "source-provider": entry.sourceProvider,
        },
        label: "optimized",
      });

      this.stateStore.update(entry.cineprintPosterId, {
        state: "OPTIMIZED_UPLOADED",
        optimizedUploaded: true,
        lastError: null,
      });
      await this.saveState();

      const verification = await this.verifyBoth(entry, source, optimized);
      if (!verification.originalPublic || !verification.optimizedPublic) {
        const message = verification.reason ?? "Public verification failed";
        this.stateStore.update(entry.cineprintPosterId, { state: "FAILED", lastError: message });
        await this.saveState();
        return { posterId: entry.cineprintPosterId, state: "FAILED", message };
      }

      const verifiedAt = new Date().toISOString();
      this.stateStore.update(entry.cineprintPosterId, {
        state: "VERIFIED",
        verifiedAt,
        lastError: null,
      });
      await this.saveState();

      return {
        posterId: entry.cineprintPosterId,
        state: "VERIFIED",
        message: "Original and optimized assets uploaded and verified",
        source: {
          sha256: source.sha256,
          mimeType: source.mimeType,
          sizeBytes: source.sizeBytes,
          dimensions: source.dimensions,
        },
        optimized: {
          sha256: optimized.sha256,
          sizeBytes: optimized.sizeBytes,
          dimensions: { width: optimized.width, height: optimized.height },
        },
        original: {
          key: entry.originalR2Key,
          uploaded: original.uploaded,
          alreadyVerified: original.alreadyVerified,
        },
        optimizedVariant: {
          key: entry.optimizedR2Key,
          uploaded: optimizedResult.uploaded,
          alreadyVerified: optimizedResult.alreadyVerified,
        },
        publicUrls: {
          original: publicUrl(this.publicBaseUrl, entry.originalR2Key),
          optimized: publicUrl(this.publicBaseUrl, entry.optimizedR2Key),
        },
      };
    } catch (error) {
      const cause = error instanceof RetryExhaustedError ? error.lastError : error;
      const state: MigrationStateName =
        cause instanceof R2ConflictError
          ? "CONFLICT"
          : cause instanceof R2VerificationError || cause instanceof R2UploadError
            ? "FAILED"
            : "FAILED";
      const message =
        cause instanceof R2ConflictError
          ? redactSecrets(cause.message)
          : redactSecrets(error instanceof Error ? error.message : String(error));
      this.stateStore.update(entry.cineprintPosterId, { state, lastError: message });
      await this.saveState();
      return { posterId: entry.cineprintPosterId, state, message };
    }
  }

  async inspectEntry(entry: ManifestEntry): Promise<InspectionResult> {
    const blocked = blockedReason(entry, this.approvals);
    if (blocked) {
      return {
        posterId: entry.cineprintPosterId,
        blocked: true,
        blockedReason: blocked,
        originalStatus: "MISSING",
        optimizedStatus: "MISSING",
        originalHead: null,
        optimizedHead: null,
        message: blocked,
      };
    }

    if (!entry.originalR2Key || !entry.optimizedR2Key) {
      return {
        posterId: entry.cineprintPosterId,
        blocked: false,
        blockedReason: null,
        originalStatus: "ERROR",
        optimizedStatus: "ERROR",
        originalHead: null,
        optimizedHead: null,
        message: "Missing R2 keys",
      };
    }

    try {
      const [originalHead, optimizedHead] = await Promise.all([
        this.r2.head(entry.originalR2Key),
        this.r2.head(entry.optimizedR2Key),
      ]);

      let originalStatus: InspectionResult["originalStatus"] = "MISSING";
      if (originalHead) {
        const actual = this.objectChecksum(originalHead);
        originalStatus =
          actual && entry.sourceSha256 && actual === entry.sourceSha256.toLowerCase()
            ? "ALREADY_VERIFIED"
            : "CONFLICT";
      }

      let optimizedStatus: InspectionResult["optimizedStatus"] = "MISSING";
      if (optimizedHead) {
        const sizeMatches =
          !entry.existingOptimizedObject.sizeBytes ||
          optimizedHead.size === entry.existingOptimizedObject.sizeBytes;
        optimizedStatus = sizeMatches ? "PRESENT" : "CONFLICT";
      }

      return {
        posterId: entry.cineprintPosterId,
        blocked: false,
        blockedReason: null,
        originalStatus,
        optimizedStatus,
        originalHead,
        optimizedHead,
        message: `original=${originalStatus}; optimized=${optimizedStatus}`,
      };
    } catch (error) {
      return {
        posterId: entry.cineprintPosterId,
        blocked: false,
        blockedReason: null,
        originalStatus: "ERROR",
        optimizedStatus: "ERROR",
        originalHead: null,
        optimizedHead: null,
        message: redactSecrets(error instanceof Error ? error.message : String(error)),
      };
    }
  }

  async inspectAll(entries: ManifestEntry[] = this.manifest.entries): Promise<InspectionResult[]> {
    return this.mapWithConcurrency(entries, (entry) => this.inspectEntry(entry));
  }

  async verifyEntry(entry: ManifestEntry): Promise<VerificationResult> {
    const empty: VerificationResult["original"] = {
      exists: false,
      metadataVerified: false,
      expectedChecksumAvailable: false,
      originChecksumVerified: false,
      publicResponds: false,
      publicChecksumVerified: false,
      checksumVerified: false,
      publicVerified: false,
      reason: "Missing R2 key",
    };
    if (!entry.originalR2Key || !entry.optimizedR2Key) {
      return { posterId: entry.cineprintPosterId, original: empty, optimized: empty };
    }

    const state = this.stateStore.get(entry.cineprintPosterId);
    const stateErrors =
      state?.state === "VERIFIED"
        ? validateVerifiedStateEntry(state, {
            posterId: entry.cineprintPosterId,
            sourceSha256: entry.sourceSha256,
            originalKey: entry.originalR2Key,
            optimizedKey: entry.optimizedR2Key,
            sourceSizeBytes: entry.sourceSizeBytes,
            sourceDimensions: entry.sourceDimensions,
          })
        : ["state is not VERIFIED"];
    const trustedState = stateErrors.length === 0 ? state : null;

    const originalExpectedAvailable = Boolean(
      entry.sourceSha256 && entry.sourceSizeBytes && entry.sourceMimeType,
    );
    const originalHead = originalExpectedAvailable ? null : await this.r2.head(entry.originalR2Key);
    const originalOrigin = originalExpectedAvailable
      ? await this.r2.verifyOrigin(entry.originalR2Key, {
          sha256: entry.sourceSha256!,
          sizeBytes: entry.sourceSizeBytes!,
          contentType: entry.sourceMimeType!,
          cacheControl: R2_CACHE_CONTROL,
        })
      : null;

    const originalMetadata = originalOrigin
      ? { ok: originalOrigin.metadataOk, reason: originalOrigin.reason }
      : validateObjectMetadata(originalHead, {
          contentType: entry.sourceMimeType ?? "",
          cacheControl: R2_CACHE_CONTROL,
        });

    const originalPublic = await this.publicVerifyWithRetry(
      publicUrl(this.publicBaseUrl, entry.originalR2Key),
      originalExpectedAvailable
        ? {
            sha256: entry.sourceSha256!,
            sizeBytes: entry.sourceSizeBytes!,
            contentType: entry.sourceMimeType!,
          }
        : undefined,
    );

    const original: VerificationResult["original"] = {
      exists: originalOrigin ? originalOrigin.exists : Boolean(originalHead),
      metadataVerified: originalMetadata.ok,
      expectedChecksumAvailable: originalExpectedAvailable,
      originChecksumVerified: originalOrigin?.checksumOk ?? false,
      publicResponds: originalPublic.status === 200,
      publicChecksumVerified: originalExpectedAvailable && originalPublic.ok,
      checksumVerified: originalOrigin?.checksumOk ?? false,
      publicVerified: originalExpectedAvailable && originalPublic.ok,
      reason:
        !originalOrigin && !originalHead
          ? "Object not found"
          : !originalMetadata.ok
            ? originalMetadata.reason
            : !originalOrigin?.checksumOk
              ? (originalOrigin?.reason ?? "Origin checksum unavailable")
              : !originalPublic.ok
                ? (originalPublic.reason ?? "Public verification failed")
                : null,
    };

    const optimizedExpectedSha = trustedState?.optimizedSha256 ?? null;
    const optimizedExpectedSize = trustedState?.optimizedSizeBytes ?? null;
    const optimizedExpectedAvailable = Boolean(optimizedExpectedSha && optimizedExpectedSize);
    const optimizedHead = optimizedExpectedAvailable
      ? null
      : await this.r2.head(entry.optimizedR2Key);
    const optimizedOrigin = optimizedExpectedAvailable
      ? await this.r2.verifyOrigin(entry.optimizedR2Key, {
          sha256: optimizedExpectedSha!,
          sizeBytes: optimizedExpectedSize!,
          contentType: "image/webp",
          cacheControl: R2_CACHE_CONTROL,
        })
      : null;

    const optimizedMetadata = optimizedOrigin
      ? { ok: optimizedOrigin.metadataOk, reason: optimizedOrigin.reason }
      : validateObjectMetadata(optimizedHead, {
          contentType: "image/webp",
          cacheControl: R2_CACHE_CONTROL,
        });

    const optimizedPublic = await this.publicVerifyWithRetry(
      publicUrl(this.publicBaseUrl, entry.optimizedR2Key),
      optimizedExpectedAvailable
        ? {
            sha256: optimizedExpectedSha!,
            sizeBytes: optimizedExpectedSize!,
            contentType: "image/webp",
          }
        : undefined,
    );

    const optimized: VerificationResult["optimized"] = {
      exists: optimizedOrigin ? optimizedOrigin.exists : Boolean(optimizedHead),
      metadataVerified: optimizedMetadata.ok,
      expectedChecksumAvailable: optimizedExpectedAvailable,
      originChecksumVerified: optimizedOrigin?.checksumOk ?? false,
      publicResponds: optimizedPublic.status === 200,
      publicChecksumVerified: optimizedExpectedAvailable && optimizedPublic.ok,
      checksumVerified: optimizedOrigin?.checksumOk ?? false,
      publicVerified: optimizedExpectedAvailable && optimizedPublic.ok,
      reason:
        !optimizedOrigin && !optimizedHead
          ? "Object not found"
          : !optimizedMetadata.ok
            ? optimizedMetadata.reason
            : !optimizedExpectedAvailable
              ? "Expected optimized checksum unavailable; origin checksum UNVERIFIED"
              : !optimizedOrigin?.checksumOk
                ? (optimizedOrigin?.reason ?? "Origin checksum mismatch")
                : !optimizedPublic.ok
                  ? (optimizedPublic.reason ?? "Public verification failed")
                  : null,
    };

    return { posterId: entry.cineprintPosterId, original, optimized };
  }

  async verifyAll(entries: ManifestEntry[] = this.manifest.entries): Promise<VerificationResult[]> {
    return this.mapWithConcurrency(entries, (entry) => this.verifyEntry(entry));
  }

  buildCanaryPlan(requestedPosterIds?: string[]): CanaryPlanItem[] {
    return buildPlan(this.manifest, this.approvals, { requestedPosterIds });
  }

  async canary(requestedPosterIds?: string[]): Promise<CanaryResult> {
    const plan = this.buildCanaryPlan(requestedPosterIds);
    const blocked = plan.filter((item) => item.blocked);
    if (this.execute && blocked.length > 0) {
      throw new Error(
        `Canary contains blocked entries: ${blocked
          .map((item) => `${item.posterId} (${item.identityConfidence})`)
          .join(
            ", ",
          )}. Resolve source availability before executing. Medium-confidence entries are never eligible for the canary.`,
      );
    }

    if (!this.execute) {
      return { plan, results: [] };
    }

    const entries = plan.map((item) => {
      const entry = this.manifest.entries.find(
        (candidate) => candidate.cineprintPosterId === item.posterId,
      );
      if (!entry) throw new Error(`Unknown canary poster ID: ${item.posterId}`);
      return entry;
    });

    const startedAt = Date.now();
    this.emit({
      type: "run.started",
      outcome: "started",
      operation: "canary",
      metadata: { posters: entries.length },
    });
    this.emit({
      type: "batch.started",
      outcome: "started",
      operation: "canary",
      metadata: { posters: entries.length },
    });
    try {
      const results = await this.stateStore.withLock(() =>
        this.mapWithConcurrency(entries, (entry) => this.migrateEntry(entry)),
      );
      this.emit({
        type: "batch.completed",
        outcome: "completed",
        operation: "canary",
        durationMs: Date.now() - startedAt,
        metadata: { posters: results.length },
      });
      this.emit({
        type: "run.completed",
        outcome: "completed",
        operation: "canary",
        durationMs: Date.now() - startedAt,
        metadata: { posters: results.length },
      });
      return { plan, results };
    } catch (error) {
      this.emit(
        {
          type: "run.completed",
          outcome: "failed",
          operation: "canary",
          durationMs: Date.now() - startedAt,
          failureCategory: classifyFailure(error),
          retryable: false,
          message: error instanceof Error ? error.message : String(error),
        },
        error,
      );
      throw error;
    }
  }

  async run(entries: ManifestEntry[] = this.manifest.entries): Promise<MigrationResult[]> {
    if (!this.execute) {
      return [];
    }
    const startedAt = Date.now();
    this.emit({
      type: "run.started",
      outcome: "started",
      operation: "run",
      metadata: { posters: entries.length },
    });
    this.emit({
      type: "batch.started",
      outcome: "started",
      operation: "run",
      metadata: { posters: entries.length },
    });
    try {
      const results = await this.stateStore.withLock(() =>
        this.mapWithConcurrency(entries, (entry) => this.migrateEntry(entry)),
      );
      this.emit({
        type: "batch.completed",
        outcome: "completed",
        operation: "run",
        durationMs: Date.now() - startedAt,
        metadata: { posters: results.length },
      });
      this.emit({
        type: "run.completed",
        outcome: "completed",
        operation: "run",
        durationMs: Date.now() - startedAt,
        metadata: { posters: results.length },
      });
      return results;
    } catch (error) {
      this.emit(
        {
          type: "run.completed",
          outcome: "failed",
          operation: "run",
          durationMs: Date.now() - startedAt,
          failureCategory: classifyFailure(error),
          retryable: false,
          message: error instanceof Error ? error.message : String(error),
        },
        error,
      );
      throw error;
    }
  }

  private async mapWithConcurrency<T, R>(
    items: T[],
    worker: (item: T) => Promise<R>,
  ): Promise<R[]> {
    const results: Array<R | undefined> = new Array(items.length);
    let index = 0;
    let fatalError: unknown;
    let hasFatalError = false;

    const workers = Array.from({ length: Math.min(this.concurrency, items.length) }, async () => {
      while (true) {
        if (hasFatalError) return;
        const current = index++;
        if (current >= items.length) return;

        try {
          results[current] = await worker(items[current]);
        } catch (error) {
          if (!hasFatalError) {
            hasFatalError = true;
            fatalError = error;
          }
          return;
        }
      }
    });

    // Wait for every worker to settle before the caller releases migration
    // locks. An abort signal would not prove an in-flight R2 request stopped,
    // so workers that are already running are allowed to finish.
    await Promise.allSettled(workers);

    if (hasFatalError) {
      throw fatalError;
    }

    return results as R[];
  }
}
