import fs from "node:fs";
import path from "node:path";
import { isSha256Hex, sha256Hex } from "./checksum";
import type { ManifestEntry, PosterManifest } from "./types";

export interface ManifestValidationOptions {
  expectedCount?: number;
  requireFirestoreSnapshot?: boolean;
}

export interface ManifestValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export interface FirestoreIdentitySnapshot {
  count: number;
  documents: Array<{
    id: string;
    notionPageId: string;
    raindropId: string | null;
    title: string;
    status: string;
    image: string;
    posterImageUrl: string;
  }>;
}

export interface Approvals {
  path: string;
  exists: boolean;
  approved: Set<string>;
}

const VALID_PROVIDERS = new Set(["raindrop-file", "pbs-twimg"]);
const VALID_CONFIDENCE = new Set(["high", "medium", "low", "none"]);
const VALID_MIGRATION_STATUS = new Set([
  "READY_TO_COPY",
  "READY_WITH_REVIEW",
  "SOURCE_UNAVAILABLE",
  "INVALID_OR_MISSING",
]);
const VALID_OPTIMIZED_ACTION = new Set(["reuse-existing", "regenerate"]);

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function duplicateValues(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

export function loadJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

export function loadManifest(
  manifestPath: string,
  options: ManifestValidationOptions = {},
): PosterManifest {
  const manifest = loadJson<PosterManifest>(manifestPath);
  const validation = validateManifest(manifest, options);
  if (!validation.ok) {
    throw new Error(`Manifest validation failed:\n- ${validation.errors.join("\n- ")}`);
  }
  return manifest;
}

export function validateManifest(
  manifest: PosterManifest,
  options: ManifestValidationOptions = {},
): ManifestValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const expectedCount = options.expectedCount ?? 63;

  if (manifest.schemaVersion !== 1) {
    errors.push(`Unsupported manifest schemaVersion: ${String(manifest.schemaVersion)}`);
  }
  if (!Array.isArray(manifest.entries)) {
    return { ok: false, errors: [...errors, "manifest.entries must be an array"], warnings };
  }
  if (manifest.entries.length !== expectedCount) {
    errors.push(`Expected ${expectedCount} entries, found ${manifest.entries.length}`);
  }

  const ids: string[] = [];
  const sourceUrls: string[] = [];
  const raindropIds: string[] = [];
  const originalKeys: string[] = [];
  const optimizedKeys: string[] = [];
  const sha256Values: string[] = [];

  for (const entry of manifest.entries) {
    const prefix = `[${entry.cineprintPosterId || "unknown"}]`;
    if (!nonEmptyString(entry.cineprintPosterId)) errors.push(`${prefix} missing cineprintPosterId`);
    if (!nonEmptyString(entry.notionPageId)) errors.push(`${prefix} missing notionPageId`);
    if (!nonEmptyString(entry.notionTitle)) errors.push(`${prefix} missing notionTitle`);
    if (!nonEmptyString(entry.currentImageUrl)) errors.push(`${prefix} missing currentImageUrl`);
    if (entry.identityReconciled !== true) errors.push(`${prefix} identityReconciled must be true`);
    if (entry.notionDerivedId !== entry.cineprintPosterId) {
      errors.push(`${prefix} notionDerivedId must equal cineprintPosterId`);
    }

    if (!VALID_PROVIDERS.has(entry.sourceProvider)) {
      errors.push(`${prefix} invalid sourceProvider: ${String(entry.sourceProvider)}`);
    }
    if (!nonEmptyString(entry.sourceImageUrl)) {
      errors.push(`${prefix} missing sourceImageUrl`);
    } else {
      let parsed: URL;
      try {
        parsed = new URL(entry.sourceImageUrl);
      } catch {
        errors.push(`${prefix} sourceImageUrl is not a valid URL`);
        parsed = null as never;
      }
      if (parsed) {
        if (parsed.protocol !== "https:") {
          errors.push(`${prefix} sourceImageUrl must use https`);
        }
        if (entry.sourceProvider === "raindrop-file" && parsed.hostname !== "api.raindrop.io") {
          errors.push(`${prefix} Raindrop source must use api.raindrop.io`);
        }
        if (entry.sourceProvider === "pbs-twimg" && parsed.hostname !== "pbs.twimg.com") {
          errors.push(`${prefix} pbs source must use pbs.twimg.com`);
        }
        if (/[?&](token|access_token|authorization|secret|key)=/i.test(parsed.search)) {
          errors.push(`${prefix} sourceImageUrl appears to contain a credential`);
        }
      }
      sourceUrls.push(entry.sourceImageUrl!);
    }

    if (!isSha256Hex(entry.sourceSha256)) {
      errors.push(`${prefix} sourceSha256 must be a 64-character hex SHA-256`);
    } else {
      sha256Values.push(entry.sourceSha256!);
    }
    if (typeof entry.sourceSizeBytes !== "number" || entry.sourceSizeBytes <= 0) {
      errors.push(`${prefix} sourceSizeBytes must be a positive number`);
    }
    if (
      !entry.sourceDimensions ||
      entry.sourceDimensions.width <= 0 ||
      entry.sourceDimensions.height <= 0
    ) {
      errors.push(`${prefix} sourceDimensions must be positive`);
    }
    if (!entry.sourceMimeType || !entry.sourceMimeType.startsWith("image/")) {
      errors.push(`${prefix} sourceMimeType must be an image MIME type`);
    }
    if (entry.sourceAvailability !== "available") {
      warnings.push(`${prefix} sourceAvailability is ${entry.sourceAvailability}; entry will be blocked`);
    }

    if (!VALID_CONFIDENCE.has(entry.identityConfidence)) {
      errors.push(`${prefix} invalid identityConfidence`);
    }
    if (!VALID_MIGRATION_STATUS.has(entry.migrationStatus)) {
      errors.push(`${prefix} invalid migrationStatus`);
    }
    if (!VALID_OPTIMIZED_ACTION.has(entry.optimizedAction)) {
      errors.push(`${prefix} invalid optimizedAction`);
    }

    if (!nonEmptyString(entry.originalR2Key)) {
      errors.push(`${prefix} missing originalR2Key`);
    } else {
      if (!/^cineprint\/(raindrop|external)\//.test(entry.originalR2Key)) {
        errors.push(`${prefix} originalR2Key must use cineprint/raindrop/ or cineprint/external/`);
      }
      originalKeys.push(entry.originalR2Key);
      if (entry.currentImageObjectKey && entry.originalR2Key !== entry.currentImageObjectKey) {
        errors.push(`${prefix} originalR2Key must mirror currentImageObjectKey`);
      }
    }

    if (!nonEmptyString(entry.optimizedR2Key)) {
      errors.push(`${prefix} missing optimizedR2Key`);
    } else {
      if (!entry.optimizedR2Key.startsWith("cineprint/optimized/")) {
        errors.push(`${prefix} optimizedR2Key must use cineprint/optimized/`);
      }
      optimizedKeys.push(entry.optimizedR2Key);
      const expectedOptimizedKey = entry.cineprintPosterId.startsWith("artwork-")
        ? `cineprint/optimized/${entry.raindropId}.webp`
        : entry.originalR2Key?.startsWith("cineprint/external/")
          ? `cineprint/optimized/external/${entry.cineprintPosterId}.webp`
          : `cineprint/optimized/legacy/${entry.cineprintPosterId}.webp`;
      if (entry.optimizedR2Key !== expectedOptimizedKey) {
        errors.push(
          `${prefix} optimizedR2Key does not follow the existing convention (expected ${expectedOptimizedKey})`,
        );
      }
    }

    if (!entry.raindropId) {
      errors.push(`${prefix} missing raindropId`);
    } else {
      raindropIds.push(entry.raindropId);
    }

    if (!entry.existingOriginalObject?.exists) {
      warnings.push(`${prefix} existing Blob original is not present in metadata`);
    }
    if (entry.sourceMatchesExistingOriginal === false) {
      warnings.push(`${prefix} source size/MIME does not match the Blob original`);
    }

    ids.push(entry.cineprintPosterId);
  }

  for (const [label, values] of [
    ["cineprintPosterId", ids],
    ["sourceImageUrl", sourceUrls],
    ["raindropId", raindropIds],
    ["originalR2Key", originalKeys],
    ["optimizedR2Key", optimizedKeys],
    ["sourceSha256", sha256Values],
  ] as const) {
    const duplicates = duplicateValues(values);
    if (duplicates.length > 0) {
      errors.push(`Duplicate ${label}: ${duplicates.join(", ")}`);
    }
  }

  if (options.requireFirestoreSnapshot) {
    // The caller validates the snapshot separately; this flag is a reminder.
  }

  return { ok: errors.length === 0, errors, warnings };
}

export function loadFirestoreSnapshot(snapshotPath: string): FirestoreIdentitySnapshot {
  const snapshot = loadJson<FirestoreIdentitySnapshot>(snapshotPath);
  if (!Array.isArray(snapshot.documents)) {
    throw new Error("Firestore snapshot must contain a documents array");
  }
  if (snapshot.count !== snapshot.documents.length) {
    throw new Error(
      `Firestore snapshot count mismatch: count=${snapshot.count}, documents=${snapshot.documents.length}`,
    );
  }
  return snapshot;
}

export function validateAgainstSnapshot(
  manifest: PosterManifest,
  snapshot: FirestoreIdentitySnapshot,
): ManifestValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const snapshotById = new Map(snapshot.documents.map((doc) => [doc.id, doc]));

  if (snapshot.documents.length !== manifest.entries.length) {
    errors.push(
      `Snapshot has ${snapshot.documents.length} documents; manifest has ${manifest.entries.length} entries`,
    );
  }

  const manifestIds = new Set(manifest.entries.map((entry) => entry.cineprintPosterId));
  for (const doc of snapshot.documents) {
    if (!manifestIds.has(doc.id)) {
      errors.push(`Snapshot document ${doc.id} is missing from the manifest`);
    }
  }

  for (const entry of manifest.entries) {
    const doc = snapshotById.get(entry.cineprintPosterId);
    if (!doc) {
      errors.push(`Manifest entry ${entry.cineprintPosterId} is missing from the snapshot`);
      continue;
    }
    if (entry.notionPageId !== doc.notionPageId) {
      errors.push(`${entry.cineprintPosterId} notionPageId differs from the snapshot`);
    }
    if (entry.currentImageUrl !== doc.image) {
      errors.push(`${entry.cineprintPosterId} currentImageUrl differs from the snapshot`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

export function loadApprovals(approvalsPath: string, manifest: PosterManifest): Approvals {
  if (!fs.existsSync(approvalsPath)) {
    return { path: approvalsPath, exists: false, approved: new Set() };
  }

  const raw = loadJson<{ approved?: string[] } | string[]>(approvalsPath);
  const ids = Array.isArray(raw) ? raw : Array.isArray(raw.approved) ? raw.approved : [];
  const manifestById = new Map(manifest.entries.map((entry) => [entry.cineprintPosterId, entry]));
  const approved = new Set<string>();

  for (const id of ids) {
    if (typeof id !== "string" || !id.trim()) continue;
    const entry = manifestById.get(id.trim());
    if (!entry) {
      throw new Error(`Approval references unknown poster ID: ${id}`);
    }
    if (entry.identityConfidence === "high") {
      throw new Error(`Approval references a high-confidence poster; not required: ${id}`);
    }
    approved.add(entry.cineprintPosterId);
  }

  return { path: approvalsPath, exists: true, approved };
}

export function isEntryBlocked(entry: ManifestEntry, approvals: Approvals): boolean {
  if (entry.sourceAvailability !== "available") return true;
  if (entry.migrationStatus === "SOURCE_UNAVAILABLE" || entry.migrationStatus === "INVALID_OR_MISSING") {
    return true;
  }
  if (entry.identityConfidence !== "high") {
    return !approvals.approved.has(entry.cineprintPosterId);
  }
  return false;
}

export function blockedReason(entry: ManifestEntry, approvals: Approvals): string | null {
  if (entry.sourceAvailability !== "available") {
    return `Source availability is ${entry.sourceAvailability}`;
  }
  if (entry.migrationStatus === "SOURCE_UNAVAILABLE" || entry.migrationStatus === "INVALID_OR_MISSING") {
    return `Manifest migration status is ${entry.migrationStatus}`;
  }
  if (entry.identityConfidence !== "high" && !approvals.approved.has(entry.cineprintPosterId)) {
    return `Identity confidence is ${entry.identityConfidence}; explicit approval is required`;
  }
  return null;
}

export function manifestHash(manifest: PosterManifest): string {
  // The entries are the authoritative migration input. Exclude volatile metadata
  // such as generatedAt and sourceCommit so the hash is stable across re-runs.
  return sha256Hex(Buffer.from(JSON.stringify(manifest.entries)));
}

export function publicUrl(baseUrl: string, key: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${key.replace(/^\/+/, "")}`;
}

export interface ExpectedObject {
  posterId: string;
  variant: "original" | "optimized";
  key: string;
  contentType: string;
  expectedSizeBytes: number | null;
  expectedSha256: string | null;
}

export function expectedObjects(manifest: PosterManifest): ExpectedObject[] {
  const objects: ExpectedObject[] = [];
  for (const entry of manifest.entries) {
    if (!entry.originalR2Key || !entry.optimizedR2Key) continue;
    objects.push({
      posterId: entry.cineprintPosterId,
      variant: "original",
      key: entry.originalR2Key,
      contentType: entry.sourceMimeType ?? "application/octet-stream",
      expectedSizeBytes: entry.sourceSizeBytes,
      expectedSha256: entry.sourceSha256,
    });
    objects.push({
      posterId: entry.cineprintPosterId,
      variant: "optimized",
      key: entry.optimizedR2Key,
      contentType: "image/webp",
      expectedSizeBytes: entry.existingOptimizedObject.exists
        ? entry.existingOptimizedObject.sizeBytes
        : null,
      expectedSha256: null,
    });
  }
  return objects;
}

export function resolveManifestPath(input?: string): string {
  return input ?? path.resolve(process.cwd(), "migration", "poster-manifest.json");
}

export function resolveSnapshotPath(input?: string): string {
  return input ?? path.resolve(process.cwd(), "migration", "firestore-identities.json");
}

export function resolveApprovalsPath(input?: string): string {
  return input ?? path.resolve(process.cwd(), "migration", "medium-confidence-approvals.json");
}

export function resolveStatePath(input?: string): string {
  return input ?? path.resolve(process.cwd(), "migration", "migration-state.json");
}
