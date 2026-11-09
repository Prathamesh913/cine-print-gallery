import { base64ToHex } from "./checksum";
import { R2_CACHE_CONTROL, R2InconclusiveError, normalizeCacheControl } from "./r2";
import type { R2ObjectMetadata, R2Store } from "./types";
import {
  DEFAULT_VERSIONED_QUALITY,
  DEFAULT_VERSIONED_WIDTH,
  LEGACY_CANARY_KEYS,
  buildLegacyCanaryHistory,
  buildVersionedMigrationPlan,
  extensionForMime,
  optimizerSlug,
  originalVersionKey,
  optimizedVersionKey,
  sourceVersionId,
  optimizedVersionId,
  toPublicVersionUrls,
  type LegacyCanaryMapEntry,
  type OptimizerIdentity,
  type VersionedMigrationPlan,
} from "./versioning";
import type { ManifestEntry, MigrationStateEntry, PosterManifest } from "./types";

export class PreflightError extends Error {}

export type PreflightClassification =
  "ABSENT" | "EXISTS_MATCH" | "EXISTS_MISMATCH" | "UNKNOWN" | "ERROR";

export type PreflightEvidence = "LIVE_HEAD" | "LOCAL_PLAN_ONLY" | "NOT_ATTEMPTED";

export interface PreflightCheck {
  name: string;
  ok: boolean | null;
  detail: string;
}

export interface PreflightExpectation {
  posterId: string;
  variant: "original" | "optimized";
  key: string;
  versionId: string;
  sha256: string | null;
  sizeBytes: number | null;
  contentType: string;
  cacheControl: string;
  requiredUserMetadata: Record<string, string | null>;
  limitations: string[];
}

export interface PreflightResult {
  posterId: string;
  variant: "original" | "optimized";
  key: string;
  versionId: string;
  classification: PreflightClassification;
  evidence: PreflightEvidence;
  reason: string;
  checks: PreflightCheck[];
  metadata: R2ObjectMetadata | null;
  limitations: string[];
}

export interface PreflightLocalValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
  eligiblePosters: number;
  plannedKeys: number;
  duplicateKeys: string[];
  canaryKeysExcluded: boolean;
  canaryUrlsMatch: boolean;
}

export interface PreflightSummary {
  total: number;
  absent: number;
  existsMatch: number;
  existsMismatch: number;
  unknown: number;
  error: number;
  complete: boolean;
  blocksUpload: boolean;
}

export interface PreflightReport {
  schemaVersion: 1;
  generatedAt: string;
  mode: "local" | "live";
  optimizerIdentity: OptimizerIdentity;
  scope: {
    eligiblePosters: number;
    plannedKeys: number;
    excluded: Array<{ posterId: string; reason: string }>;
  };
  localValidation: PreflightLocalValidation;
  liveEvidence: {
    performed: boolean;
    headRequests: number;
    note: string;
  };
  results: PreflightResult[];
  summary: PreflightSummary;
}

export const DEFAULT_PREFLIGHT_HEAD_TIMEOUT_MS = 10_000;
export const MAX_PREFLIGHT_HEAD_TIMEOUT_MS = 60_000;
export const DEFAULT_PREFLIGHT_CONCURRENCY = 8;

function manifestEntryFor(manifest: PosterManifest, posterId: string): ManifestEntry {
  const entry = manifest.entries.find((candidate) => candidate.cineprintPosterId === posterId);
  if (!entry) throw new PreflightError(`Manifest entry is missing for ${posterId}`);
  return entry;
}

export function buildPreflightExpectations(
  manifest: PosterManifest,
  plan: VersionedMigrationPlan,
): PreflightExpectation[] {
  const expectations: PreflightExpectation[] = [];
  for (const item of plan.items) {
    if (item.eligibility !== "ELIGIBLE") continue;
    const entry = manifestEntryFor(manifest, item.posterId);
    if (!entry.sourceSha256 || !entry.sourceMimeType || entry.sourceSizeBytes === null) {
      throw new PreflightError(`Manifest metadata is incomplete for ${item.posterId}`);
    }
    let extension: string;
    try {
      extension = extensionForMime(entry.sourceMimeType);
    } catch {
      throw new PreflightError(`Cannot derive an extension for ${item.posterId}`);
    }

    const originalKey = originalVersionKey(item.posterId, item.sourceSha256, extension);
    const optimizedKey = optimizedVersionKey(
      item.posterId,
      item.optimizedSha256,
      item.optimizerIdentity,
      DEFAULT_VERSIONED_WIDTH,
      DEFAULT_VERSIONED_QUALITY,
    );
    if (originalKey !== item.originalKey || optimizedKey !== item.optimizedKey) {
      throw new PreflightError(
        `Plan key does not match the final key convention for ${item.posterId}`,
      );
    }

    expectations.push({
      posterId: item.posterId,
      variant: "original",
      key: originalKey,
      versionId: sourceVersionId(item.posterId, item.sourceSha256),
      sha256: item.sourceSha256.toLowerCase(),
      sizeBytes: entry.sourceSizeBytes,
      contentType: entry.sourceMimeType.toLowerCase(),
      cacheControl: R2_CACHE_CONTROL,
      requiredUserMetadata: {
        "poster-id": item.posterId,
        variant: "original",
        sha256: item.sourceSha256.toLowerCase(),
        "source-provider": entry.sourceProvider,
      },
      limitations: [],
    });

    expectations.push({
      posterId: item.posterId,
      variant: "optimized",
      key: optimizedKey,
      versionId: optimizedVersionId(
        item.posterId,
        item.optimizedSha256,
        item.optimizerIdentity,
        DEFAULT_VERSIONED_WIDTH,
        DEFAULT_VERSIONED_QUALITY,
      ),
      sha256: item.optimizedSha256,
      sizeBytes: item.optimizedBytes,
      contentType: "image/webp",
      cacheControl: R2_CACHE_CONTROL,
      requiredUserMetadata: {
        "poster-id": item.posterId,
        variant: "optimized",
        sha256: null,
        "source-sha256": item.sourceSha256.toLowerCase(),
        optimizer: optimizerSlug(item.optimizerIdentity),
        width: String(DEFAULT_VERSIONED_WIDTH),
        quality: String(DEFAULT_VERSIONED_QUALITY),
      },
      limitations: [],
    });
  }
  return expectations;
}

function validateCanaryPreservation(input: {
  manifest: PosterManifest;
  stateEntries: Record<string, MigrationStateEntry>;
  mapEntries: Record<string, LegacyCanaryMapEntry>;
  publicBaseUrl: string;
}): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  for (const [posterId, keys] of Object.entries(LEGACY_CANARY_KEYS)) {
    const manifestEntry = input.manifest.entries.find(
      (entry) => entry.cineprintPosterId === posterId,
    );
    if (!manifestEntry) {
      errors.push(`Canary manifest entry is missing: ${posterId}`);
      continue;
    }
    const stateEntry = input.stateEntries[posterId];
    const mapEntry = input.mapEntries[posterId];
    if (!stateEntry || !mapEntry) {
      errors.push(`Canary state or map entry is missing: ${posterId}`);
      continue;
    }
    try {
      const history = buildLegacyCanaryHistory({ manifestEntry, stateEntry, mapEntry });
      const urls = toPublicVersionUrls(history, input.publicBaseUrl);
      if (urls.original !== mapEntry.original.url || urls.optimized !== mapEntry.optimized.url) {
        errors.push(`Canary public URLs do not match the existing map for ${posterId}`);
      }
      const current = history.originals[history.currentOriginalVersionId ?? ""];
      if (!current || current.originalKey !== keys.original) {
        errors.push(`Canary original key changed for ${posterId}`);
      }
      const optimized = history.optimized[history.currentOptimizedVersionId ?? ""];
      if (!optimized || optimized.optimizedKey !== keys.optimized) {
        errors.push(`Canary optimized key changed for ${posterId}`);
      }
    } catch (error) {
      errors.push(
        `Canary history is invalid for ${posterId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  return { ok: errors.length === 0, errors };
}

export function validatePreflightPlan(input: {
  manifest: PosterManifest;
  plan: VersionedMigrationPlan;
  expectations: PreflightExpectation[];
  stateEntries?: Record<string, MigrationStateEntry>;
  mapEntries?: Record<string, LegacyCanaryMapEntry>;
  publicBaseUrl?: string;
}): PreflightLocalValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const expectation of input.expectations) {
    if (seen.has(expectation.key)) duplicates.add(expectation.key);
    seen.add(expectation.key);
  }

  if (input.plan.summary.eligible !== 58) {
    errors.push(`Expected 58 eligible posters, found ${input.plan.summary.eligible}`);
  }
  if (input.expectations.length !== 116) {
    errors.push(`Expected 116 planned keys, found ${input.expectations.length}`);
  }
  if (duplicates.size > 0) {
    errors.push(`Duplicate planned keys: ${[...duplicates].sort().join(", ")}`);
  }

  const perPoster = new Map<string, number>();
  for (const expectation of input.expectations) {
    perPoster.set(expectation.posterId, (perPoster.get(expectation.posterId) ?? 0) + 1);
  }
  for (const [posterId, count] of perPoster) {
    if (count !== 2) errors.push(`Poster ${posterId} has ${count} planned keys, expected 2`);
  }

  const canaryKeys = new Set(
    Object.values(LEGACY_CANARY_KEYS).flatMap((keys) => [keys.original, keys.optimized]),
  );
  const canaryKeysExcluded = input.expectations.every(
    (expectation) => !canaryKeys.has(expectation.key),
  );
  if (!canaryKeysExcluded) {
    errors.push("A legacy canary key appeared in the versioned pre-flight scope");
  }

  let canaryUrlsMatch = false;
  if (input.stateEntries && input.mapEntries && input.publicBaseUrl) {
    const canary = validateCanaryPreservation({
      manifest: input.manifest,
      stateEntries: input.stateEntries,
      mapEntries: input.mapEntries,
      publicBaseUrl: input.publicBaseUrl,
    });
    canaryUrlsMatch = canary.ok;
    errors.push(...canary.errors);
  } else {
    warnings.push("Canary preservation was not validated because state/map inputs were omitted");
  }

  const optimizerComplete = input.plan.items.every((item) => item.optimizerIdentityComplete);
  if (!optimizerComplete) {
    warnings.push("Optimizer identity is incomplete for at least one planned key");
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    eligiblePosters: input.plan.summary.eligible,
    plannedKeys: input.expectations.length,
    duplicateKeys: [...duplicates].sort(),
    canaryKeysExcluded,
    canaryUrlsMatch,
  };
}

function metadataChecksum(metadata: R2ObjectMetadata): string | null {
  if (metadata.metadataSha256) return metadata.metadataSha256.toLowerCase();
  if (metadata.checksumSha256) {
    try {
      return base64ToHex(metadata.checksumSha256);
    } catch {
      return null;
    }
  }
  return null;
}

export function classifyPreflightMetadata(
  expectation: PreflightExpectation,
  metadata: R2ObjectMetadata,
): { classification: PreflightClassification; reason: string; checks: PreflightCheck[] } {
  const checks: PreflightCheck[] = [];
  const push = (name: string, ok: boolean | null, detail: string) => {
    checks.push({ name, ok, detail });
  };

  const actualContentType = metadata.contentType
    ? metadata.contentType.split(";")[0].trim().toLowerCase()
    : null;
  const expectedContentType = expectation.contentType.split(";")[0].trim().toLowerCase();
  push(
    "content-type",
    actualContentType === expectedContentType,
    `expected ${expectedContentType}, found ${actualContentType ?? "missing"}`,
  );

  const actualCacheControl = normalizeCacheControl(metadata.cacheControl);
  const expectedCacheControl = normalizeCacheControl(expectation.cacheControl);
  push(
    "cache-control",
    actualCacheControl === expectedCacheControl,
    `expected ${expectation.cacheControl}, found ${metadata.cacheControl ?? "missing"}`,
  );

  if (expectation.sizeBytes !== null) {
    push(
      "content-length",
      metadata.size === expectation.sizeBytes,
      `expected ${expectation.sizeBytes}, found ${metadata.size}`,
    );
  } else {
    push("content-length", null, "expected length is unknown before optimization");
  }

  if (expectation.sha256 !== null) {
    const actual = metadataChecksum(metadata);
    push(
      "sha256",
      actual === expectation.sha256,
      `expected ${expectation.sha256}, found ${actual ?? "missing"}`,
    );
  } else {
    const declared = metadata.userMetadata?.sha256 ?? null;
    push(
      "sha256",
      declared !== null && declared.length > 0 ? null : false,
      declared
        ? "object declares a checksum but it cannot be compared before optimization"
        : "object has no sha256 user metadata",
    );
  }

  for (const [key, expectedValue] of Object.entries(expectation.requiredUserMetadata)) {
    const actual = metadata.userMetadata?.[key.toLowerCase()];
    if (actual === undefined || actual === "") {
      push(`metadata:${key}`, false, "missing");
    } else if (expectedValue === null) {
      push(`metadata:${key}`, null, `present (${actual}) but not locally verifiable`);
    } else {
      push(
        `metadata:${key}`,
        actual === expectedValue,
        `expected ${expectedValue}, found ${actual}`,
      );
    }
  }

  const failed = checks.filter((check) => check.ok === false);
  if (failed.length > 0) {
    return {
      classification: "EXISTS_MISMATCH",
      reason: failed.map((check) => `${check.name}: ${check.detail}`).join("; "),
      checks,
    };
  }
  const inconclusive = checks.filter((check) => check.ok === null);
  if (inconclusive.length > 0) {
    // Identity metadata may match, but a check that cannot be concluded is not
    // proof that the object is safe to adopt. Fail closed as UNKNOWN.
    return {
      classification: "UNKNOWN",
      reason: `Object identity metadata matches, but these checks are inconclusive: ${inconclusive
        .map((check) => `${check.name}: ${check.detail}`)
        .join("; ")}`,
      checks,
    };
  }
  return {
    classification: "EXISTS_MATCH",
    reason: "All expected metadata matches",
    checks,
  };
}

async function headWithTimeout(
  store: R2Store,
  key: string,
  timeoutMs: number,
): Promise<
  | { kind: "absent" }
  | { kind: "found"; metadata: R2ObjectMetadata }
  | { kind: "unknown"; reason: string }
  | { kind: "error"; reason: string }
> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error(`HeadObject timed out after ${timeoutMs}ms`));
  }, timeoutMs);
  try {
    const metadata = await Promise.race([
      store.head(key, { signal: controller.signal }),
      new Promise<never>((_resolve, reject) => {
        controller.signal.addEventListener(
          "abort",
          () => reject(new R2InconclusiveError(`HeadObject timed out after ${timeoutMs}ms`)),
          { once: true },
        );
      }),
    ]);
    if (!metadata) return { kind: "absent" };
    return { kind: "found", metadata };
  } catch (error) {
    if (controller.signal.aborted || error instanceof R2InconclusiveError) {
      return {
        kind: "unknown",
        reason: error instanceof Error ? error.message : "HeadObject was inconclusive",
      };
    }
    return {
      kind: "error",
      reason: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), items.length) },
    async () => {
      while (true) {
        const current = index++;
        if (current >= items.length) return;
        results[current] = await worker(items[current]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

export interface RunPreflightOptions {
  manifest: PosterManifest;
  plan?: VersionedMigrationPlan;
  optimizer?: OptimizerIdentity;
  optimizedArtifacts?: Record<string, import("./versioning").OptimizedArtifactMetadata>;
  stateEntries?: Record<string, MigrationStateEntry>;
  mapEntries?: Record<string, LegacyCanaryMapEntry>;
  publicBaseUrl?: string;
  mode?: "local" | "live";
  store?: R2Store;
  allowLiveHead?: boolean;
  concurrency?: number;
  headTimeoutMs?: number;
  now?: () => Date;
}

export async function runPreflight(options: RunPreflightOptions): Promise<PreflightReport> {
  const optimizer = options.optimizer ?? options.plan?.items[0]?.optimizerIdentity ?? undefined;
  const plan =
    options.plan ??
    buildVersionedMigrationPlan(options.manifest, {
      optimizer,
      width: DEFAULT_VERSIONED_WIDTH,
      quality: DEFAULT_VERSIONED_QUALITY,
      optimizedArtifacts: options.optimizedArtifacts,
    });
  const expectations = buildPreflightExpectations(options.manifest, plan);
  const localValidation = validatePreflightPlan({
    manifest: options.manifest,
    plan,
    expectations,
    stateEntries: options.stateEntries,
    mapEntries: options.mapEntries,
    publicBaseUrl: options.publicBaseUrl,
  });

  const mode = options.mode ?? "local";
  if (mode === "live" && !options.allowLiveHead) {
    throw new PreflightError(
      "Live pre-flight requires explicit authorization (allowLiveHead: true). No HeadObject request was made.",
    );
  }
  if (mode === "live" && !options.store) {
    throw new PreflightError("Live pre-flight requires an R2 store. No request was made.");
  }

  const timeoutMs = Math.min(
    Math.max(1, options.headTimeoutMs ?? DEFAULT_PREFLIGHT_HEAD_TIMEOUT_MS),
    MAX_PREFLIGHT_HEAD_TIMEOUT_MS,
  );

  let headRequests = 0;
  let results: PreflightResult[];

  if (mode === "local") {
    results = expectations.map((expectation) => ({
      posterId: expectation.posterId,
      variant: expectation.variant,
      key: expectation.key,
      versionId: expectation.versionId,
      classification: "UNKNOWN" as const,
      evidence: "LOCAL_PLAN_ONLY" as const,
      reason:
        "Live HeadObject pre-flight was not authorized in this run; absence is not proven and uploads remain blocked",
      checks: [],
      metadata: null,
      limitations: expectation.limitations,
    }));
  } else {
    results = await mapWithConcurrency(
      expectations,
      options.concurrency ?? DEFAULT_PREFLIGHT_CONCURRENCY,
      async (expectation) => {
        headRequests += 1;
        const outcome = await headWithTimeout(options.store!, expectation.key, timeoutMs);
        if (outcome.kind === "absent") {
          return {
            posterId: expectation.posterId,
            variant: expectation.variant,
            key: expectation.key,
            versionId: expectation.versionId,
            classification: "ABSENT" as const,
            evidence: "LIVE_HEAD" as const,
            reason: "HeadObject returned 404; the key is absent",
            checks: [],
            metadata: null,
            limitations: expectation.limitations,
          };
        }
        if (outcome.kind === "found") {
          const classified = classifyPreflightMetadata(expectation, outcome.metadata);
          return {
            posterId: expectation.posterId,
            variant: expectation.variant,
            key: expectation.key,
            versionId: expectation.versionId,
            classification: classified.classification,
            evidence: "LIVE_HEAD" as const,
            reason: classified.reason,
            checks: classified.checks,
            metadata: outcome.metadata,
            limitations: expectation.limitations,
          };
        }
        return {
          posterId: expectation.posterId,
          variant: expectation.variant,
          key: expectation.key,
          versionId: expectation.versionId,
          classification: outcome.kind === "unknown" ? ("UNKNOWN" as const) : ("ERROR" as const),
          evidence: "NOT_ATTEMPTED" as const,
          reason: outcome.reason,
          checks: [],
          metadata: null,
          limitations: expectation.limitations,
        };
      },
    );
  }

  const summary = summarizePreflight(
    results,
    mode === "live",
    localValidation.ok,
    expectations.length,
  );
  return {
    schemaVersion: 1,
    generatedAt: (options.now ?? (() => new Date()))().toISOString(),
    mode,
    optimizerIdentity: optimizer ?? { name: "sharp", version: "unknown", libvipsVersion: null },
    scope: {
      eligiblePosters: plan.summary.eligible,
      plannedKeys: expectations.length,
      excluded: plan.excluded,
    },
    localValidation,
    liveEvidence: {
      performed: mode === "live",
      headRequests,
      note:
        mode === "live"
          ? "Read-only HeadObject requests were made. No object was written or adopted."
          : "Local plan validation only. No R2 request was made and no bucket claim is made.",
    },
    results,
    summary,
  };
}

export function summarizePreflight(
  results: PreflightResult[],
  live: boolean,
  localValidationOk: boolean,
  expectedTotal = results.length,
): PreflightSummary {
  const count = (classification: PreflightClassification) =>
    results.filter((result) => result.classification === classification).length;
  const unknown = count("UNKNOWN");
  const error = count("ERROR");
  const existsMismatch = count("EXISTS_MISMATCH");
  const complete =
    live &&
    results.length === expectedTotal &&
    results.length > 0 &&
    unknown === 0 &&
    error === 0 &&
    results.every((result) => result.evidence === "LIVE_HEAD");
  return {
    total: results.length,
    absent: count("ABSENT"),
    existsMatch: count("EXISTS_MATCH"),
    existsMismatch,
    unknown,
    error,
    complete,
    blocksUpload: !localValidationOk || !complete || existsMismatch > 0,
  };
}

export function renderPreflightSummary(report: PreflightReport): string {
  const lines = [
    "R2 versioned-key pre-flight (read-only)",
    `  mode: ${report.mode}`,
    `  generated: ${report.generatedAt}`,
    `  optimizer: ${report.optimizerIdentity.name} ${report.optimizerIdentity.version} / libvips ${report.optimizerIdentity.libvipsVersion ?? "unknown"}`,
    `  eligible posters: ${report.scope.eligiblePosters}`,
    `  planned keys: ${report.scope.plannedKeys}`,
    `  local validation: ${report.localValidation.ok ? "ok" : "FAILED"}`,
    `  canary keys excluded: ${report.localValidation.canaryKeysExcluded ? "yes" : "no"}`,
    `  canary URLs unchanged: ${report.localValidation.canaryUrlsMatch ? "yes" : "no"}`,
    `  live evidence performed: ${report.liveEvidence.performed ? "yes" : "no"}`,
    `  HeadObject requests: ${report.liveEvidence.headRequests}`,
    `  absent: ${report.summary.absent}`,
    `  exists-match: ${report.summary.existsMatch}`,
    `  exists-mismatch: ${report.summary.existsMismatch}`,
    `  unknown: ${report.summary.unknown}`,
    `  error: ${report.summary.error}`,
    `  complete: ${report.summary.complete ? "yes" : "no"}`,
    `  uploads blocked: ${report.summary.blocksUpload ? "yes" : "no"}`,
    `  note: ${report.liveEvidence.note}`,
  ];
  if (report.localValidation.errors.length > 0) {
    lines.push("  local validation errors:");
    for (const error of report.localValidation.errors) lines.push(`    - ${error}`);
  }
  if (report.localValidation.warnings.length > 0) {
    lines.push("  warnings:");
    for (const warning of report.localValidation.warnings) lines.push(`    - ${warning}`);
  }
  return lines.join("\n");
}
