import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import sharp from "sharp";
import type { ManifestEntry, MigrationStateEntry, PosterManifest } from "./types";

export class VersioningError extends Error {}

export type VersionStatus = "pending" | "verified" | "failed" | "superseded" | "current";
export type SourceProvider = "raindrop-file" | "pbs-twimg" | "unknown";

export interface OptimizerIdentity {
  name: string;
  version: string;
  libvipsVersion: string | null;
}

export interface OptimizedArtifactMetadata {
  posterId: string;
  sourceSha256: string;
  optimizedSha256: string;
  optimizedBytes: number;
  width: number;
  height: number;
  mimeType: string;
  optimizer: OptimizerIdentity;
  transformation: { width: number; quality: number; format: "webp" };
}

export interface OriginalVersion {
  kind: "original";
  posterId: string;
  versionId: string;
  sourceProvider: SourceProvider;
  sourceUrlSafe: string;
  sourceRevision: number;
  sourceSha256: string;
  originalSha256: string;
  originalBytes: number;
  mimeType: string;
  extension: string;
  originalKey: string;
  verifiedAt: string | null;
  status: VersionStatus;
  legacy: boolean;
  provenanceLimitations: string[];
}

export interface OptimizedVersion {
  kind: "optimized";
  posterId: string;
  versionId: string;
  sourceVersionId: string;
  sourceSha256: string;
  optimizedSha256: string;
  optimizedBytes: number;
  width: number;
  quality: number | null;
  optimizerName: string;
  optimizerVersion: string;
  libvipsVersion: string | null;
  optimizedKey: string;
  verifiedAt: string | null;
  status: VersionStatus;
  legacy: boolean;
  provenanceLimitations: string[];
}

export interface PosterVersionHistory {
  schemaVersion: 1;
  posterId: string;
  currentOriginalVersionId: string | null;
  currentOptimizedVersionId: string | null;
  originals: Record<string, OriginalVersion>;
  optimized: Record<string, OptimizedVersion>;
}

export interface VersionedMapEntry {
  posterId: string;
  legacy: boolean;
  currentOriginal: OriginalVersion;
  currentOptimized: OptimizedVersion;
  originals: OriginalVersion[];
  optimized: OptimizedVersion[];
}

export interface VersionedMapFile {
  schemaVersion: 1;
  publicBaseUrl: string;
  entries: Record<string, VersionedMapEntry>;
  skipped: Array<{ posterId: string; reason: string }>;
}

export interface VersionedMigrationPlanItem {
  posterId: string;
  sourceProvider: SourceProvider;
  sourceSha256: string;
  sourceRevision: number;
  sourceVersionId: string;
  originalKey: string;
  optimizedVersionId: string;
  optimizedKey: string;
  optimizedSha256: string;
  optimizedBytes: number;
  optimizedDimensions: { width: number; height: number };
  optimizerIdentity: OptimizerIdentity;
  optimizerIdentityComplete: boolean;
  existingR2ConflictRisk: "LOCAL_CONFLICT" | "LIVE_R2_CHECK_REQUIRED";
  eligibility: "ELIGIBLE" | "EXCLUDED";
  reason: string;
}

export interface VersionedMigrationPlan {
  items: VersionedMigrationPlanItem[];
  excluded: Array<{ posterId: string; reason: string }>;
  summary: {
    eligible: number;
    excluded: number;
    newObjects: number;
    totalHighConfidenceObjects: number;
    localConflicts: number;
    liveR2ChecksRequired: number;
  };
}

export interface LegacyCanaryMapEntry {
  posterId: string;
  blobImageUrl: string;
  original: {
    key: string;
    url: string;
    sha256: string;
    sizeBytes: number;
    contentType: string;
  };
  optimized: {
    key: string;
    url: string;
    sha256: string;
    sizeBytes: number;
    contentType: string;
  };
  verifiedAt: string;
}

const POSTER_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const EXTENSION_PATTERN = /^(jpg|png|webp|gif)$/;
const OPTIMIZER_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;
const OPTIMIZER_VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._-]*$/;
const MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export const DEFAULT_VERSIONED_WIDTH = 800;
export const DEFAULT_VERSIONED_QUALITY = 80;

export const LEGACY_CANARY_KEYS = {
  "2001-a-space-odyssey": {
    original: "cineprint/raindrop/1528361110.png",
    optimized: "cineprint/optimized/legacy/2001-a-space-odyssey.webp",
  },
  bugonia: {
    original: "cineprint/external/bugonia.jpg",
    optimized: "cineprint/optimized/external/bugonia.webp",
  },
  "artwork-1824607248": {
    original: "cineprint/raindrop/1824607248.jpg",
    optimized: "cineprint/optimized/1824607248.webp",
  },
} as const;

const CANARY_IDS = Object.keys(LEGACY_CANARY_KEYS) as Array<keyof typeof LEGACY_CANARY_KEYS>;

function assertPosterId(value: unknown): string {
  if (typeof value !== "string" || !POSTER_ID_PATTERN.test(value)) {
    throw new VersioningError(`Invalid poster ID: ${String(value)}`);
  }
  return value;
}

function normalizeSha256(value: unknown): string {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw new VersioningError("SHA-256 must be 64 hexadecimal characters");
  }
  return value.toLowerCase();
}

function normalizeExtension(value: unknown): string {
  if (typeof value !== "string") throw new VersioningError("Extension must be a string");
  const normalized = value.toLowerCase() === "jpeg" ? "jpg" : value.toLowerCase();
  if (!EXTENSION_PATTERN.test(normalized)) {
    throw new VersioningError(`Unsafe or unsupported extension: ${value}`);
  }
  return normalized;
}

export function extensionForMime(mimeType: string): string {
  const normalized = String(mimeType || "").toLowerCase();
  const extension = MIME_EXTENSIONS[normalized];
  if (!extension) throw new VersioningError(`Unsupported MIME type: ${mimeType}`);
  return extension;
}

function assertMimeType(value: unknown): string {
  if (typeof value !== "string" || !MIME_EXTENSIONS[value.toLowerCase()]) {
    throw new VersioningError(`Unsupported MIME type: ${String(value)}`);
  }
  return value.toLowerCase();
}

function assertPositiveInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new VersioningError(`${label} must be a positive integer`);
  }
  return value;
}

function assertQuality(value: unknown, legacy: boolean): number | null {
  if (legacy && value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 100) {
    throw new VersioningError("quality must be an integer between 1 and 100");
  }
  return value;
}

function assertIsoDate(value: unknown): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new VersioningError("verifiedAt must be a valid ISO date");
  }
  return value;
}

function assertStatusInvariant(status: VersionStatus, verifiedAt: string | null): void {
  if (!["pending", "verified", "failed", "superseded", "current"].includes(status)) {
    throw new VersioningError(`Unknown version status: ${String(status)}`);
  }
  if (["current", "verified", "superseded"].includes(status) && !verifiedAt) {
    throw new VersioningError(`Status ${status} requires verifiedAt`);
  }
  if (["pending", "failed"].includes(status) && verifiedAt) {
    throw new VersioningError(`Status ${status} must not have verifiedAt`);
  }
}

function assertOptimizerIdentity(identity: OptimizerIdentity): OptimizerIdentity {
  if (!identity || typeof identity !== "object") {
    throw new VersioningError("Optimizer identity is required");
  }
  if (!OPTIMIZER_NAME_PATTERN.test(identity.name)) {
    throw new VersioningError(`Invalid optimizer name: ${String(identity.name)}`);
  }
  if (!OPTIMIZER_VERSION_PATTERN.test(identity.version)) {
    throw new VersioningError(`Invalid optimizer version: ${String(identity.version)}`);
  }
  if (
    identity.libvipsVersion !== null &&
    !OPTIMIZER_VERSION_PATTERN.test(identity.libvipsVersion)
  ) {
    throw new VersioningError(`Invalid libvips version: ${String(identity.libvipsVersion)}`);
  }
  return identity;
}

export function optimizerSlug(identity: OptimizerIdentity): string {
  const safe = assertOptimizerIdentity(identity);
  const libvips = safe.libvipsVersion ?? "unknown";
  return `${safe.name}-${safe.version}-libvips-${libvips}`;
}

export function originalVersionKey(
  posterId: string,
  sourceSha256: string,
  extension: string,
): string {
  const id = assertPosterId(posterId);
  const sha = normalizeSha256(sourceSha256);
  const ext = normalizeExtension(extension);
  // Full SHA-256 is used in the object key so two distinct sources can never
  // share a key through a truncated-prefix collision.
  return `cineprint/versions/original/${id}/${sha}.${ext}`;
}

export function optimizedVersionKey(
  posterId: string,
  sourceSha256: string,
  optimizer: OptimizerIdentity,
  width: number,
  quality: number,
): string {
  const id = assertPosterId(posterId);
  const sha = normalizeSha256(sourceSha256);
  const w = assertPositiveInteger(width, "width");
  const q = assertQuality(quality, false);
  const slug = optimizerSlug(optimizer);
  return `cineprint/versions/optimized/${id}/${sha}-${slug}-w${w}-q${q}.webp`;
}

export function sourceVersionId(posterId: string, sourceSha256: string): string {
  return `src-${assertPosterId(posterId)}-${normalizeSha256(sourceSha256)}`;
}

export function optimizedVersionId(
  posterId: string,
  sourceSha256: string,
  optimizer: OptimizerIdentity,
  width: number,
  quality: number,
): string {
  const w = assertPositiveInteger(width, "width");
  const q = assertQuality(quality, false);
  return `opt-${assertPosterId(posterId)}-${normalizeSha256(sourceSha256)}-${optimizerSlug(optimizer)}-w${w}-q${q}`;
}

export function legacyVersionId(posterId: string, variant: "original" | "optimized"): string {
  return `legacy-${assertPosterId(posterId)}-${variant}`;
}

/**
 * Fails closed if two different full source checksums ever map to the same
 * version ID. Keys now embed the full SHA-256, so this is a defence against a
 * future truncated-ID regression rather than an expected condition.
 */
export function assertNoSourceChecksumCollision(
  entries: Array<{ versionId: string; sourceSha256: string }>,
): void {
  const seen = new Map<string, string>();
  for (const entry of entries) {
    const sha = normalizeSha256(entry.sourceSha256);
    const previous = seen.get(entry.versionId);
    if (previous !== undefined && previous !== sha) {
      throw new VersioningError(
        `Source checksum collision for version ID ${entry.versionId}: ${previous} and ${sha}`,
      );
    }
    seen.set(entry.versionId, sha);
  }
}

export function getOptimizerIdentity(): OptimizerIdentity {
  let version = "unknown";
  try {
    const require = createRequire(import.meta.url);
    const entry = require.resolve("sharp");
    const packagePath = path.resolve(path.dirname(entry), "..", "package.json");
    const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8")) as {
      version?: string;
    };
    if (typeof packageJson.version === "string") version = packageJson.version;
  } catch {
    // Explicitly retain "unknown" rather than inventing a version.
  }
  const versions = (sharp as unknown as { versions?: Record<string, string> }).versions;
  const libvipsVersion = versions?.vips ?? null;
  return { name: "sharp", version, libvipsVersion };
}

function assertLegacyCanary(posterId: string): keyof typeof LEGACY_CANARY_KEYS {
  if (!CANARY_IDS.includes(posterId as keyof typeof LEGACY_CANARY_KEYS)) {
    throw new VersioningError(`Legacy keys are only supported for canary posters: ${posterId}`);
  }
  return posterId as keyof typeof LEGACY_CANARY_KEYS;
}

function assertLegacyKey(posterId: string, variant: "original" | "optimized", key: string): void {
  const canary = assertLegacyCanary(posterId);
  const expected = LEGACY_CANARY_KEYS[canary][variant];
  if (key !== expected) {
    throw new VersioningError(`Legacy ${variant} key does not match the canary fixture: ${key}`);
  }
}

export function validateOriginalVersion(record: OriginalVersion): void {
  if (!record || record.kind !== "original") {
    throw new VersioningError("Original version has the wrong kind");
  }
  const posterId = assertPosterId(record.posterId);
  const sourceSha = normalizeSha256(record.sourceSha256);
  const originalSha = normalizeSha256(record.originalSha256);
  if (sourceSha !== originalSha) {
    throw new VersioningError("Original checksum must equal the source checksum");
  }
  const mimeType = assertMimeType(record.mimeType);
  const extension = normalizeExtension(record.extension);
  if (extensionForMime(mimeType) !== extension) {
    throw new VersioningError("Original extension does not match its MIME type");
  }
  assertPositiveInteger(record.originalBytes, "originalBytes");
  assertPositiveInteger(record.sourceRevision, "sourceRevision");
  if (typeof record.sourceUrlSafe !== "string" || !record.sourceUrlSafe.trim()) {
    throw new VersioningError("sourceUrlSafe is required");
  }
  assertStatusInvariant(record.status, record.verifiedAt);
  if (record.verifiedAt) assertIsoDate(record.verifiedAt);

  if (record.legacy) {
    assertLegacyCanary(posterId);
    assertLegacyKey(posterId, "original", record.originalKey);
    if (record.versionId !== legacyVersionId(posterId, "original")) {
      throw new VersioningError("Legacy original versionId is invalid");
    }
  } else {
    if (record.versionId !== sourceVersionId(posterId, sourceSha)) {
      throw new VersioningError("Original versionId does not match its identity");
    }
    if (record.originalKey !== originalVersionKey(posterId, sourceSha, extension)) {
      throw new VersioningError("Original key does not match its version identity");
    }
  }
}

export function validateOptimizedVersion(record: OptimizedVersion): void {
  if (!record || record.kind !== "optimized") {
    throw new VersioningError("Optimized version has the wrong kind");
  }
  const posterId = assertPosterId(record.posterId);
  const sourceSha = normalizeSha256(record.sourceSha256);
  const optimizedSha = normalizeSha256(record.optimizedSha256);
  assertPositiveInteger(record.optimizedBytes, "optimizedBytes");
  assertPositiveInteger(record.width, "width");
  assertQuality(record.quality, record.legacy);
  assertStatusInvariant(record.status, record.verifiedAt);
  if (record.verifiedAt) assertIsoDate(record.verifiedAt);
  if (!record.optimizedKey.endsWith(".webp")) {
    throw new VersioningError("Optimized key must end with .webp");
  }

  if (record.legacy) {
    assertLegacyCanary(posterId);
    assertLegacyKey(posterId, "optimized", record.optimizedKey);
    if (record.versionId !== legacyVersionId(posterId, "optimized")) {
      throw new VersioningError("Legacy optimized versionId is invalid");
    }
    if (record.sourceVersionId !== legacyVersionId(posterId, "original")) {
      throw new VersioningError("Legacy optimized sourceVersionId is invalid");
    }
    if (record.optimizerName !== "legacy" || record.optimizerVersion !== "unknown") {
      throw new VersioningError("Legacy optimized optimizer identity is invalid");
    }
  } else {
    const optimizer = assertOptimizerIdentity({
      name: record.optimizerName,
      version: record.optimizerVersion,
      libvipsVersion: record.libvipsVersion,
    });
    if (
      record.versionId !==
      optimizedVersionId(posterId, optimizedSha, optimizer, record.width, record.quality as number)
    ) {
      throw new VersioningError("Optimized versionId does not match its identity");
    }
    if (
      record.optimizedKey !==
      optimizedVersionKey(posterId, optimizedSha, optimizer, record.width, record.quality as number)
    ) {
      throw new VersioningError("Optimized key does not match its version identity");
    }
  }
}

function currentIds(history: PosterVersionHistory, variant: "original" | "optimized"): string[] {
  const records =
    variant === "original" ? Object.values(history.originals) : Object.values(history.optimized);
  return records.filter((record) => record.status === "current").map((record) => record.versionId);
}

export function validateVersionHistory(history: PosterVersionHistory): void {
  if (!history || history.schemaVersion !== 1) {
    throw new VersioningError("Unsupported version history schema");
  }
  const posterId = assertPosterId(history.posterId);
  if (!history.originals || typeof history.originals !== "object") {
    throw new VersioningError("originals must be an object");
  }
  if (!history.optimized || typeof history.optimized !== "object") {
    throw new VersioningError("optimized must be an object");
  }

  const originalKeys = new Set<string>();
  for (const [key, record] of Object.entries(history.originals)) {
    validateOriginalVersion(record);
    if (record.posterId !== posterId) {
      throw new VersioningError("Original version posterId does not match the history");
    }
    if (key !== record.versionId) {
      throw new VersioningError("Original record key must equal versionId");
    }
    if (originalKeys.has(record.originalKey)) {
      throw new VersioningError("Duplicate original object key");
    }
    originalKeys.add(record.originalKey);
  }
  const optimizedKeys = new Set<string>();
  for (const [key, record] of Object.entries(history.optimized)) {
    validateOptimizedVersion(record);
    if (record.posterId !== posterId) {
      throw new VersioningError("Optimized version posterId does not match the history");
    }
    if (key !== record.versionId) {
      throw new VersioningError("Optimized record key must equal versionId");
    }
    if (optimizedKeys.has(record.optimizedKey)) {
      throw new VersioningError("Duplicate optimized object key");
    }
    optimizedKeys.add(record.optimizedKey);
    const source = history.originals[record.sourceVersionId];
    if (!source) {
      throw new VersioningError("Optimized derivative references a missing source version");
    }
    if (source.originalSha256 !== record.sourceSha256) {
      throw new VersioningError("Optimized source checksum does not match its original version");
    }
  }

  const originalCurrent = currentIds(history, "original");
  const optimizedCurrent = currentIds(history, "optimized");
  if (originalCurrent.length > 1) {
    throw new VersioningError("Multiple current original versions");
  }
  if (optimizedCurrent.length > 1) {
    throw new VersioningError("Multiple current optimized versions");
  }
  if (history.currentOriginalVersionId) {
    const record = history.originals[history.currentOriginalVersionId];
    if (!record || record.status !== "current") {
      throw new VersioningError("Current original pointer does not match a current record");
    }
  } else if (originalCurrent.length > 0) {
    throw new VersioningError("Current original record exists without a pointer");
  }
  if (history.currentOptimizedVersionId) {
    const record = history.optimized[history.currentOptimizedVersionId];
    if (!record || record.status !== "current") {
      throw new VersioningError("Current optimized pointer does not match a current record");
    }
  } else if (optimizedCurrent.length > 0) {
    throw new VersioningError("Current optimized record exists without a pointer");
  }

  if (history.currentOriginalVersionId && history.currentOptimizedVersionId) {
    const original = history.originals[history.currentOriginalVersionId];
    const optimized = history.optimized[history.currentOptimizedVersionId];
    if (optimized.sourceVersionId !== original.versionId) {
      throw new VersioningError(
        "Current optimized derivative does not belong to the current original",
      );
    }
  }
}

export function createOriginalVersion(input: {
  posterId: string;
  sourceProvider: SourceProvider;
  sourceUrlSafe: string;
  sourceRevision: number;
  sourceSha256: string;
  originalSha256?: string;
  originalBytes: number;
  mimeType: string;
  extension: string;
  originalKey?: string;
  verifiedAt?: string | null;
  status?: VersionStatus;
  legacy?: boolean;
  provenanceLimitations?: string[];
}): OriginalVersion {
  const posterId = assertPosterId(input.posterId);
  const sourceSha = normalizeSha256(input.sourceSha256);
  const originalSha = normalizeSha256(input.originalSha256 ?? input.sourceSha256);
  const extension = normalizeExtension(input.extension);
  const verifiedAt = input.verifiedAt ?? null;
  const legacy = Boolean(input.legacy);
  const status = input.status ?? (verifiedAt ? "verified" : "pending");
  const versionId = legacy
    ? legacyVersionId(posterId, "original")
    : sourceVersionId(posterId, sourceSha);
  const originalKey =
    input.originalKey ??
    (legacy
      ? LEGACY_CANARY_KEYS[assertLegacyCanary(posterId)].original
      : originalVersionKey(posterId, sourceSha, extension));
  const record: OriginalVersion = {
    kind: "original",
    posterId,
    versionId,
    sourceProvider: input.sourceProvider,
    sourceUrlSafe: input.sourceUrlSafe,
    sourceRevision: assertPositiveInteger(input.sourceRevision, "sourceRevision"),
    sourceSha256: sourceSha,
    originalSha256: originalSha,
    originalBytes: assertPositiveInteger(input.originalBytes, "originalBytes"),
    mimeType: assertMimeType(input.mimeType),
    extension,
    originalKey,
    verifiedAt,
    status,
    legacy,
    provenanceLimitations: [...(input.provenanceLimitations ?? [])],
  };
  validateOriginalVersion(record);
  return record;
}

export function createOptimizedVersion(input: {
  posterId: string;
  sourceVersionId: string;
  sourceSha256: string;
  optimizedSha256: string;
  optimizedBytes: number;
  width: number;
  quality: number | null;
  optimizerName: string;
  optimizerVersion: string;
  libvipsVersion: string | null;
  optimizedKey?: string;
  verifiedAt?: string | null;
  status?: VersionStatus;
  legacy?: boolean;
  provenanceLimitations?: string[];
}): OptimizedVersion {
  const posterId = assertPosterId(input.posterId);
  const sourceSha = normalizeSha256(input.sourceSha256);
  const optimizedSha = normalizeSha256(input.optimizedSha256);
  const verifiedAt = input.verifiedAt ?? null;
  const legacy = Boolean(input.legacy);
  const status = input.status ?? (verifiedAt ? "verified" : "pending");
  const quality = assertQuality(input.quality, legacy);
  const width = assertPositiveInteger(input.width, "width");
  const versionId = legacy
    ? legacyVersionId(posterId, "optimized")
    : optimizedVersionId(
        posterId,
        optimizedSha,
        {
          name: input.optimizerName,
          version: input.optimizerVersion,
          libvipsVersion: input.libvipsVersion,
        },
        width,
        quality as number,
      );
  const optimizedKey =
    input.optimizedKey ??
    (legacy
      ? LEGACY_CANARY_KEYS[assertLegacyCanary(posterId)].optimized
      : optimizedVersionKey(
          posterId,
          optimizedSha,
          {
            name: input.optimizerName,
            version: input.optimizerVersion,
            libvipsVersion: input.libvipsVersion,
          },
          width,
          quality as number,
        ));
  const record: OptimizedVersion = {
    kind: "optimized",
    posterId,
    versionId,
    sourceVersionId: input.sourceVersionId,
    sourceSha256: sourceSha,
    optimizedSha256: normalizeSha256(input.optimizedSha256),
    optimizedBytes: assertPositiveInteger(input.optimizedBytes, "optimizedBytes"),
    width,
    quality,
    optimizerName: input.optimizerName,
    optimizerVersion: input.optimizerVersion,
    libvipsVersion: input.libvipsVersion,
    optimizedKey,
    verifiedAt,
    status,
    legacy,
    provenanceLimitations: [...(input.provenanceLimitations ?? [])],
  };
  validateOptimizedVersion(record);
  return record;
}

export function addOriginalVersion(
  history: PosterVersionHistory,
  record: OriginalVersion,
): PosterVersionHistory {
  validateVersionHistory(history);
  validateOriginalVersion(record);
  if (record.posterId !== history.posterId) {
    throw new VersioningError("Original version belongs to a different poster");
  }
  if (
    history.originals[record.versionId] ||
    Object.values(history.originals).some((r) => r.originalKey === record.originalKey)
  ) {
    throw new VersioningError("Duplicate original version or key");
  }
  return {
    ...history,
    originals: { ...history.originals, [record.versionId]: record },
  };
}

export function addOptimizedVersion(
  history: PosterVersionHistory,
  record: OptimizedVersion,
): PosterVersionHistory {
  validateVersionHistory(history);
  validateOptimizedVersion(record);
  if (record.posterId !== history.posterId) {
    throw new VersioningError("Optimized version belongs to a different poster");
  }
  if (
    history.optimized[record.versionId] ||
    Object.values(history.optimized).some((r) => r.optimizedKey === record.optimizedKey)
  ) {
    throw new VersioningError("Duplicate optimized version or key");
  }
  return {
    ...history,
    optimized: { ...history.optimized, [record.versionId]: record },
  };
}

export function selectCurrentVersion(
  history: PosterVersionHistory,
  variant: "original" | "optimized",
  versionId: string,
): PosterVersionHistory {
  validateVersionHistory(history);
  const records = variant === "original" ? history.originals : history.optimized;
  const selected = records[versionId];
  if (!selected) throw new VersioningError(`Unknown ${variant} version: ${versionId}`);
  if (selected.status === "pending" || selected.status === "failed") {
    throw new VersioningError("Only verified versions can become current");
  }
  if (selected.status === "current") {
    return history;
  }
  const next: PosterVersionHistory = structuredClone(history);
  const nextRecords = variant === "original" ? next.originals : next.optimized;
  for (const record of Object.values(nextRecords)) {
    if (record.status === "current") record.status = "superseded";
  }
  nextRecords[versionId].status = "current";
  if (variant === "original") {
    next.currentOriginalVersionId = versionId;
  } else {
    next.currentOptimizedVersionId = versionId;
  }
  validateVersionHistory(next);
  return next;
}

export function rollbackToVersion(
  history: PosterVersionHistory,
  originalVersionId: string,
  optimizedVersionId: string,
): PosterVersionHistory {
  validateVersionHistory(history);
  const original = history.originals[originalVersionId];
  const optimized = history.optimized[optimizedVersionId];
  if (!original || !optimized) {
    throw new VersioningError("Rollback target is missing");
  }
  if (
    original.status === "pending" ||
    original.status === "failed" ||
    optimized.status === "pending" ||
    optimized.status === "failed"
  ) {
    throw new VersioningError("Only verified versions can be selected for rollback");
  }
  if (optimized.sourceVersionId !== original.versionId) {
    throw new VersioningError("Rollback derivative does not belong to the selected original");
  }
  const next: PosterVersionHistory = structuredClone(history);
  for (const record of Object.values(next.originals)) {
    if (record.status === "current") record.status = "superseded";
  }
  for (const record of Object.values(next.optimized)) {
    if (record.status === "current") record.status = "superseded";
  }
  next.originals[originalVersionId].status = "current";
  next.optimized[optimizedVersionId].status = "current";
  next.currentOriginalVersionId = originalVersionId;
  next.currentOptimizedVersionId = optimizedVersionId;
  validateVersionHistory(next);
  return next;
}

export function resolveCurrentVersion(history: PosterVersionHistory): {
  original: OriginalVersion;
  optimized: OptimizedVersion;
} {
  validateVersionHistory(history);
  if (!history.currentOriginalVersionId || !history.currentOptimizedVersionId) {
    throw new VersioningError("Both current original and optimized versions are required");
  }
  const original = history.originals[history.currentOriginalVersionId];
  const optimized = history.optimized[history.currentOptimizedVersionId];
  if (!original || !optimized) {
    throw new VersioningError("Current version records are missing");
  }
  return { original, optimized };
}

export function toPublicVersionUrls(
  history: PosterVersionHistory,
  publicBaseUrl: string,
): { original: string; optimized: string } {
  const current = resolveCurrentVersion(history);
  const base = publicBaseUrl.replace(/\/+$/, "");
  return {
    original: `${base}/${current.original.originalKey}`,
    optimized: `${base}/${current.optimized.optimizedKey}`,
  };
}

export function buildVersionedMap(
  histories: PosterVersionHistory[],
  publicBaseUrl: string,
): VersionedMapFile {
  const entries: Record<string, VersionedMapEntry> = {};
  const skipped: Array<{ posterId: string; reason: string }> = [];
  for (const history of histories) {
    try {
      const current = resolveCurrentVersion(history);
      entries[history.posterId] = {
        posterId: history.posterId,
        legacy: current.original.legacy || current.optimized.legacy,
        currentOriginal: current.original,
        currentOptimized: current.optimized,
        originals: Object.values(history.originals).sort((a, b) =>
          a.versionId.localeCompare(b.versionId),
        ),
        optimized: Object.values(history.optimized).sort((a, b) =>
          a.versionId.localeCompare(b.versionId),
        ),
      };
    } catch (error) {
      skipped.push({
        posterId: history.posterId,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return {
    schemaVersion: 1,
    publicBaseUrl: publicBaseUrl.replace(/\/+$/, ""),
    entries: Object.fromEntries(Object.entries(entries).sort(([a], [b]) => a.localeCompare(b))),
    skipped: skipped.sort((a, b) => a.posterId.localeCompare(b.posterId)),
  };
}

export function buildLegacyCanaryHistory(input: {
  manifestEntry: ManifestEntry;
  stateEntry: MigrationStateEntry;
  mapEntry: LegacyCanaryMapEntry;
}): PosterVersionHistory {
  const posterId = assertLegacyCanary(input.manifestEntry.cineprintPosterId);
  const mapEntry = input.mapEntry;
  const state = input.stateEntry;
  if (mapEntry.posterId !== posterId) {
    throw new VersioningError("Canary map entry posterId mismatch");
  }
  assertLegacyKey(posterId, "original", mapEntry.original.key);
  assertLegacyKey(posterId, "optimized", mapEntry.optimized.key);
  const verifiedAt = state.verifiedAt ?? mapEntry.verifiedAt;
  const width = state.optimizedDimensions?.width;
  if (!width) throw new VersioningError("Legacy canary optimized width is unavailable");
  const sourceSha = state.sourceSha256 ?? mapEntry.original.sha256;
  const original = createOriginalVersion({
    posterId,
    sourceProvider: input.manifestEntry.sourceProvider,
    sourceUrlSafe:
      input.manifestEntry.sourcePageUrl ||
      input.manifestEntry.sourceImageUrl ||
      "legacy-source-reference",
    sourceRevision: 1,
    sourceSha256: sourceSha,
    originalSha256: state.originalSha256 ?? mapEntry.original.sha256,
    originalBytes: mapEntry.original.sizeBytes,
    mimeType: mapEntry.original.contentType,
    extension: mapEntry.original.key.split(".").pop() ?? "jpg",
    originalKey: mapEntry.original.key,
    verifiedAt,
    status: "current",
    legacy: true,
    provenanceLimitations: [
      "Legacy canary key; source revision and optimizer provenance were not recorded historically.",
    ],
  });
  const optimized = createOptimizedVersion({
    posterId,
    sourceVersionId: original.versionId,
    sourceSha256: sourceSha,
    optimizedSha256: state.optimizedSha256 ?? mapEntry.optimized.sha256,
    optimizedBytes: mapEntry.optimized.sizeBytes,
    width,
    quality: null,
    optimizerName: "legacy",
    optimizerVersion: "unknown",
    libvipsVersion: null,
    optimizedKey: mapEntry.optimized.key,
    verifiedAt,
    status: "current",
    legacy: true,
    provenanceLimitations: [
      "Legacy canary derivative; optimizer version and quality were not recorded historically.",
    ],
  });
  const history: PosterVersionHistory = {
    schemaVersion: 1,
    posterId,
    currentOriginalVersionId: original.versionId,
    currentOptimizedVersionId: optimized.versionId,
    originals: { [original.versionId]: original },
    optimized: { [optimized.versionId]: optimized },
  };
  validateVersionHistory(history);
  return history;
}

export function buildVersionedMigrationPlan(
  manifest: PosterManifest,
  options: {
    optimizer?: OptimizerIdentity;
    legacyKeys?: string[];
    canaryIds?: string[];
    mediumIds?: string[];
    width?: number;
    quality?: number;
    optimizedArtifacts?: Record<string, OptimizedArtifactMetadata>;
  } = {},
): VersionedMigrationPlan {
  const optimizer = assertOptimizerIdentity(options.optimizer ?? getOptimizerIdentity());
  const width = options.width ?? DEFAULT_VERSIONED_WIDTH;
  const quality = options.quality ?? DEFAULT_VERSIONED_QUALITY;
  const canaryIds = new Set(options.canaryIds ?? CANARY_IDS);
  const mediumIds = new Set(
    options.mediumIds ??
      manifest.entries
        .filter((entry) => entry.identityConfidence === "medium")
        .map((entry) => entry.cineprintPosterId),
  );
  const legacyKeys = new Set(options.legacyKeys ?? []);
  const items: VersionedMigrationPlanItem[] = [];
  const excluded: Array<{ posterId: string; reason: string }> = [];
  const seenOriginalKeys = new Set<string>();
  const seenOptimizedKeys = new Set<string>();

  for (const entry of manifest.entries) {
    const posterId = entry.cineprintPosterId;
    if (canaryIds.has(posterId)) {
      excluded.push({ posterId, reason: "LEGACY_CANARY_PRESERVED" });
      continue;
    }
    if (mediumIds.has(posterId)) {
      excluded.push({ posterId, reason: "MEDIUM_IDENTITY_UNRESOLVED" });
      continue;
    }
    if (entry.identityConfidence !== "high") {
      excluded.push({ posterId, reason: "NOT_HIGH_CONFIDENCE" });
      continue;
    }
    if (entry.sourceAvailability !== "available" || entry.sourceHttpStatus !== 200) {
      excluded.push({ posterId, reason: "SOURCE_UNAVAILABLE" });
      continue;
    }
    if (!entry.sourceSha256 || !entry.sourceMimeType || !entry.sourceSizeBytes) {
      excluded.push({ posterId, reason: "SOURCE_METADATA_MISSING" });
      continue;
    }
    let extension: string;
    try {
      extension = extensionForMime(entry.sourceMimeType);
    } catch {
      excluded.push({ posterId, reason: "UNSUPPORTED_SOURCE_MIME" });
      continue;
    }
    const sourceSha = normalizeSha256(entry.sourceSha256);
    const artifact = options.optimizedArtifacts?.[posterId];
    if (!artifact) {
      excluded.push({ posterId, reason: "MISSING_OPTIMIZED_ARTIFACT" });
      continue;
    }
    if (artifact.posterId !== posterId) {
      excluded.push({ posterId, reason: "OPTIMIZED_ARTIFACT_POSTER_MISMATCH" });
      continue;
    }
    if (normalizeSha256(artifact.sourceSha256) !== sourceSha) {
      excluded.push({ posterId, reason: "OPTIMIZED_ARTIFACT_SOURCE_MISMATCH" });
      continue;
    }
    if (optimizerSlug(artifact.optimizer) !== optimizerSlug(optimizer)) {
      excluded.push({ posterId, reason: "OPTIMIZED_ARTIFACT_OPTIMIZER_MISMATCH" });
      continue;
    }
    if (
      artifact.transformation.width !== width ||
      artifact.transformation.quality !== quality ||
      artifact.transformation.format !== "webp" ||
      artifact.mimeType.toLowerCase() !== "image/webp"
    ) {
      excluded.push({ posterId, reason: "OPTIMIZED_ARTIFACT_SETTINGS_MISMATCH" });
      continue;
    }
    const optimizedSha = normalizeSha256(artifact.optimizedSha256);
    assertPositiveInteger(artifact.optimizedBytes, "optimizedBytes");
    const originalKey = originalVersionKey(posterId, sourceSha, extension);
    const optimizedKey = optimizedVersionKey(posterId, optimizedSha, optimizer, width, quality);
    const sourceId = sourceVersionId(posterId, sourceSha);
    const optimizedId = optimizedVersionId(posterId, optimizedSha, optimizer, width, quality);
    const localConflict =
      legacyKeys.has(originalKey) ||
      legacyKeys.has(optimizedKey) ||
      seenOriginalKeys.has(originalKey) ||
      seenOptimizedKeys.has(optimizedKey);
    seenOriginalKeys.add(originalKey);
    seenOptimizedKeys.add(optimizedKey);
    items.push({
      posterId,
      sourceProvider: entry.sourceProvider,
      sourceSha256: sourceSha,
      sourceRevision: 1,
      sourceVersionId: sourceId,
      originalKey,
      optimizedVersionId: optimizedId,
      optimizedKey,
      optimizedSha256: optimizedSha,
      optimizedBytes: artifact.optimizedBytes,
      optimizedDimensions: { width: artifact.width, height: artifact.height },
      optimizerIdentity: optimizer,
      optimizerIdentityComplete:
        optimizer.version !== "unknown" && optimizer.libvipsVersion !== null,
      existingR2ConflictRisk: localConflict ? "LOCAL_CONFLICT" : "LIVE_R2_CHECK_REQUIRED",
      eligibility: localConflict ? "EXCLUDED" : "ELIGIBLE",
      reason: localConflict ? "LOCAL_KEY_CONFLICT" : "ELIGIBLE_HIGH_CONFIDENCE_SOURCE_EXACT",
    });
    if (localConflict) excluded.push({ posterId, reason: "LOCAL_KEY_CONFLICT" });
  }

  const eligible = items.filter((item) => item.eligibility === "ELIGIBLE");
  assertNoSourceChecksumCollision([
    ...items.map((item) => ({
      versionId: item.sourceVersionId,
      sourceSha256: item.sourceSha256,
    })),
    ...items.map((item) => ({
      versionId: item.optimizedVersionId,
      sourceSha256: item.optimizedSha256,
    })),
  ]);
  return {
    items,
    excluded: excluded.sort((a, b) => a.posterId.localeCompare(b.posterId)),
    summary: {
      eligible: eligible.length,
      excluded: excluded.length,
      newObjects: eligible.length * 2,
      totalHighConfidenceObjects: 6 + eligible.length * 2,
      localConflicts: items.filter((item) => item.existingR2ConflictRisk === "LOCAL_CONFLICT")
        .length,
      liveR2ChecksRequired: eligible.length,
    },
  };
}
