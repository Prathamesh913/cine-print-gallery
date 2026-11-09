import fs from "node:fs";
import path from "node:path";
import { sha256Hex } from "./checksum";
import { describe, expect, it } from "vitest";
import {
  LEGACY_CANARY_KEYS,
  VersioningError,
  addOptimizedVersion,
  addOriginalVersion,
  assertNoSourceChecksumCollision,
  buildLegacyCanaryHistory,
  buildVersionedMap,
  buildVersionedMigrationPlan,
  createOptimizedVersion,
  createOriginalVersion,
  extensionForMime,
  getOptimizerIdentity,
  legacyVersionId,
  optimizerSlug,
  originalVersionKey,
  optimizedVersionId,
  optimizedVersionKey,
  resolveCurrentVersion,
  rollbackToVersion,
  selectCurrentVersion,
  sourceVersionId,
  toPublicVersionUrls,
  validateVersionHistory,
  type OptimizerIdentity,
  type LegacyCanaryMapEntry,
  type OptimizedArtifactMetadata,
  type OriginalVersion,
  type PosterVersionHistory,
} from "./versioning";
import type { ManifestEntry, MigrationStateEntry, PosterManifest } from "./types";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const OPT_A = "c".repeat(64);
const OPT_B = "d".repeat(64);
const VERIFIED = "2026-11-08T00:00:00.000Z";
const OPTIMIZER: OptimizerIdentity = {
  name: "sharp",
  version: "0.35.3",
  libvipsVersion: "8.18.3",
};

type OriginalInput = Parameters<typeof createOriginalVersion>[0];
type OptimizedInput = Parameters<typeof createOptimizedVersion>[0];

function makeOriginal(overrides: Partial<OriginalInput> = {}) {
  return createOriginalVersion({
    posterId: "bugonia",
    sourceProvider: "pbs-twimg",
    sourceUrlSafe: "https://example.com/source.jpg",
    sourceRevision: 1,
    sourceSha256: SHA_A,
    originalBytes: 1000,
    mimeType: "image/jpeg",
    extension: "jpg",
    verifiedAt: VERIFIED,
    status: "verified",
    ...overrides,
  });
}

function makeOptimized(original: OriginalVersion, overrides: Partial<OptimizedInput> = {}) {
  return createOptimizedVersion({
    posterId: original.posterId,
    sourceVersionId: original.versionId,
    sourceSha256: original.sourceSha256,
    optimizedSha256: OPT_A,
    optimizedBytes: 500,
    width: 800,
    quality: 80,
    optimizerName: OPTIMIZER.name,
    optimizerVersion: OPTIMIZER.version,
    libvipsVersion: OPTIMIZER.libvipsVersion,
    verifiedAt: VERIFIED,
    status: "verified",
    ...overrides,
  });
}

function makeCurrentHistory(
  originalOverrides: Partial<OriginalInput> = {},
  optimizedOverrides: Partial<OptimizedInput> = {},
): PosterVersionHistory {
  const original = makeOriginal({
    ...originalOverrides,
    status: "current",
    verifiedAt: VERIFIED,
  });
  const optimized = makeOptimized(original, {
    ...optimizedOverrides,
    status: "current",
    verifiedAt: VERIFIED,
  });
  const history: PosterVersionHistory = {
    schemaVersion: 1,
    posterId: "bugonia",
    currentOriginalVersionId: original.versionId,
    currentOptimizedVersionId: optimized.versionId,
    originals: { [original.versionId]: original },
    optimized: { [optimized.versionId]: optimized },
  };
  validateVersionHistory(history);
  return history;
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), "migration", file), "utf8")) as T;
}

describe("version identity and key generation", () => {
  it("generates deterministic original keys", () => {
    const first = originalVersionKey("bugonia", SHA_A, "jpg");
    const second = originalVersionKey("bugonia", SHA_A, "jpg");
    expect(first).toBe(second);
    expect(first).toBe(
      "cineprint/versions/original/bugonia/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg",
    );
  });

  it("uses the full SHA-256 in keys, not a truncated prefix", () => {
    const key = originalVersionKey("bugonia", SHA_A, "jpg");
    expect(key).toContain(SHA_A);
    // Two checksums sharing the same 16-character prefix must not collide.
    const sharedPrefixA = `${"a".repeat(16)}${"1".repeat(48)}`;
    const sharedPrefixB = `${"a".repeat(16)}${"2".repeat(48)}`;
    expect(originalVersionKey("bugonia", sharedPrefixA, "jpg")).not.toBe(
      originalVersionKey("bugonia", sharedPrefixB, "jpg"),
    );
    expect(optimizedVersionKey("bugonia", sharedPrefixA, OPTIMIZER, 800, 80)).not.toBe(
      optimizedVersionKey("bugonia", sharedPrefixB, OPTIMIZER, 800, 80),
    );
  });

  it("fails closed on a source checksum collision in a truncated version ID", () => {
    expect(() =>
      assertNoSourceChecksumCollision([
        { versionId: "src-bugonia-aaaaaaaaaaaaaaaa", sourceSha256: SHA_A },
        { versionId: "src-bugonia-aaaaaaaaaaaaaaaa", sourceSha256: SHA_B },
      ]),
    ).toThrow(/collision/i);
    expect(() =>
      assertNoSourceChecksumCollision([
        { versionId: "src-bugonia-aaaaaaaaaaaaaaaa", sourceSha256: SHA_A },
        { versionId: "src-bugonia-aaaaaaaaaaaaaaaa", sourceSha256: SHA_A },
      ]),
    ).not.toThrow();
  });

  it("produces different original keys for different source hashes", () => {
    expect(originalVersionKey("bugonia", SHA_A, "jpg")).not.toBe(
      originalVersionKey("bugonia", SHA_B, "jpg"),
    );
  });

  it("generates deterministic optimized keys", () => {
    const first = optimizedVersionKey("bugonia", SHA_A, OPTIMIZER, 800, 80);
    const second = optimizedVersionKey("bugonia", SHA_A, OPTIMIZER, 800, 80);
    expect(first).toBe(second);
    expect(first).toBe(
      "cineprint/versions/optimized/bugonia/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-sharp-0.35.3-libvips-8.18.3-w800-q80.webp",
    );
  });

  it("produces different optimized keys for different optimizer versions", () => {
    const v1 = optimizedVersionKey("bugonia", SHA_A, OPTIMIZER, 800, 80);
    const v2 = optimizedVersionKey("bugonia", SHA_A, { ...OPTIMIZER, version: "0.36.0" }, 800, 80);
    expect(v1).not.toBe(v2);
  });

  it("produces different optimized keys for different transformation settings", () => {
    const base = optimizedVersionKey("bugonia", SHA_A, OPTIMIZER, 800, 80);
    expect(optimizedVersionKey("bugonia", SHA_A, OPTIMIZER, 1000, 80)).not.toBe(base);
    expect(optimizedVersionKey("bugonia", SHA_A, OPTIMIZER, 800, 70)).not.toBe(base);
  });

  it("normalizes jpeg extensions and rejects unsafe extensions", () => {
    expect(originalVersionKey("bugonia", SHA_A, "jpeg")).toBe(
      "cineprint/versions/original/bugonia/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg",
    );
    expect(() => originalVersionKey("bugonia", SHA_A, "php")).toThrow(VersioningError);
    expect(() => originalVersionKey("bugonia", SHA_A, "../jpg")).toThrow(VersioningError);
    expect(() => originalVersionKey("bugonia", SHA_A, "jpg?x")).toThrow(VersioningError);
  });

  it("rejects invalid poster IDs", () => {
    expect(() => originalVersionKey("Bugonia", SHA_A, "jpg")).toThrow(VersioningError);
    expect(() => originalVersionKey("bad_id", SHA_A, "jpg")).toThrow(VersioningError);
    expect(() => originalVersionKey("../bugonia", SHA_A, "jpg")).toThrow(VersioningError);
  });

  it("rejects invalid hashes", () => {
    expect(() => originalVersionKey("bugonia", "abc", "jpg")).toThrow(VersioningError);
    expect(() => originalVersionKey("bugonia", "g".repeat(64), "jpg")).toThrow(VersioningError);
  });

  it("rejects invalid optimizer identifiers", () => {
    expect(() =>
      optimizerSlug({ name: "Sharp!", version: "0.35.3", libvipsVersion: null }),
    ).toThrow(VersioningError);
    expect(() => optimizerSlug({ name: "sharp", version: "../1", libvipsVersion: null })).toThrow(
      VersioningError,
    );
    expect(() => optimizerSlug({ name: "sharp", version: "1.0.0", libvipsVersion: "1/2" })).toThrow(
      VersioningError,
    );
  });

  it("records an unknown libvips version explicitly in the key", () => {
    expect(optimizerSlug({ ...OPTIMIZER, libvipsVersion: null })).toContain("libvips-unknown");
  });

  it("maps supported MIME types to canonical extensions", () => {
    expect(extensionForMime("image/jpeg")).toBe("jpg");
    expect(extensionForMime("image/png")).toBe("png");
    expect(extensionForMime("image/webp")).toBe("webp");
    expect(extensionForMime("image/gif")).toBe("gif");
    expect(() => extensionForMime("text/html")).toThrow(VersioningError);
  });

  it("reads the installed optimizer identity", () => {
    const identity = getOptimizerIdentity();
    expect(identity.name).toBe("sharp");
    expect(identity.version).not.toBe("unknown");
    expect(identity.libvipsVersion).toBeTruthy();
  });
});

describe("provenance and legacy canaries", () => {
  it("keeps the three legacy canary histories readable", () => {
    const manifest = readJson<PosterManifest>("poster-manifest.json");
    const state = readJson<{ entries: Record<string, MigrationStateEntry> }>(
      "migration-state.json",
    );
    const map = readJson<{
      publicBaseUrl: string;
      entries: Record<string, LegacyCanaryMapEntry>;
    }>("r2-image-map.json");
    for (const posterId of Object.keys(LEGACY_CANARY_KEYS) as Array<
      keyof typeof LEGACY_CANARY_KEYS
    >) {
      const manifestEntry = manifest.entries.find(
        (entry) => entry.cineprintPosterId === posterId,
      ) as ManifestEntry;
      const history = buildLegacyCanaryHistory({
        manifestEntry,
        stateEntry: state.entries[posterId],
        mapEntry: map.entries[posterId],
      });
      const current = resolveCurrentVersion(history);
      expect(current.original.originalKey).toBe(map.entries[posterId].original.key);
      expect(current.optimized.optimizedKey).toBe(map.entries[posterId].optimized.key);
      expect(current.original.originalSha256).toBe(map.entries[posterId].original.sha256);
      expect(current.optimized.optimizedSha256).toBe(map.entries[posterId].optimized.sha256);
      expect(toPublicVersionUrls(history, map.publicBaseUrl)).toEqual({
        original: map.entries[posterId].original.url,
        optimized: map.entries[posterId].optimized.url,
      });
      expect(history.originals[current.original.versionId].legacy).toBe(true);
      expect(history.optimized[current.optimized.versionId].legacy).toBe(true);
    }
  });

  it("keeps the existing legacy canary map entries valid", () => {
    const map = readJson<{ entries: Record<string, LegacyCanaryMapEntry> }>("r2-image-map.json");
    expect(Object.keys(map.entries)).toHaveLength(61);
    expect(map.entries["stranger-things-2"]).toBeUndefined();
    expect(map.entries["the-substance-2"]).toBeUndefined();
    for (const posterId of Object.keys(LEGACY_CANARY_KEYS) as Array<
      keyof typeof LEGACY_CANARY_KEYS
    >) {
      expect(map.entries[posterId].original.key).toBe(LEGACY_CANARY_KEYS[posterId].original);
      expect(map.entries[posterId].optimized.key).toBe(LEGACY_CANARY_KEYS[posterId].optimized);
    }
  });

  it("keeps the existing canary state readable", () => {
    const state = readJson<{ entries: Record<string, MigrationStateEntry> }>(
      "migration-state.json",
    );
    for (const posterId of Object.keys(LEGACY_CANARY_KEYS)) {
      expect(state.entries[posterId].state).toBe("VERIFIED");
      expect(state.entries[posterId].originalKey).toBe(
        LEGACY_CANARY_KEYS[posterId as keyof typeof LEGACY_CANARY_KEYS].original,
      );
      expect(state.entries[posterId].optimizedKey).toBe(
        LEGACY_CANARY_KEYS[posterId as keyof typeof LEGACY_CANARY_KEYS].optimized,
      );
    }
  });

  it("rejects legacy keys for non-canary posters", () => {
    expect(() =>
      createOriginalVersion({
        posterId: "her",
        sourceProvider: "pbs-twimg",
        sourceUrlSafe: "https://example.com/her.jpg",
        sourceRevision: 1,
        sourceSha256: SHA_A,
        originalBytes: 1000,
        mimeType: "image/jpeg",
        extension: "jpg",
        originalKey: "cineprint/external/her.jpg",
        verifiedAt: VERIFIED,
        status: "current",
        legacy: true,
      }),
    ).toThrow(VersioningError);
  });
});

describe("version history, selection and rollback", () => {
  it("keeps source revisions coexisting", () => {
    const history = makeCurrentHistory();
    const firstOriginal = Object.values(history.originals)[0];
    const firstOptimized = Object.values(history.optimized)[0];
    const secondOriginal = makeOriginal({ sourceSha256: SHA_B, status: "verified" });
    const withSecond = addOriginalVersion(history, secondOriginal);
    const secondOptimized = makeOptimized(secondOriginal, {
      optimizedSha256: OPT_B,
      status: "verified",
    });
    const withBoth = addOptimizedVersion(withSecond, secondOptimized);
    expect(Object.keys(withBoth.originals)).toHaveLength(2);
    expect(Object.keys(withBoth.optimized)).toHaveLength(2);
    expect(withBoth.currentOriginalVersionId).toBe(firstOriginal.versionId);
    expect(withBoth.originals[firstOriginal.versionId].status).toBe("current");
    expect(withBoth.optimized[firstOptimized.versionId].status).toBe("current");

    const rolledBack = rollbackToVersion(
      withBoth,
      secondOriginal.versionId,
      secondOptimized.versionId,
    );
    expect(rolledBack.currentOriginalVersionId).toBe(secondOriginal.versionId);
    expect(rolledBack.originals[firstOriginal.versionId].status).toBe("superseded");
    expect(rolledBack.originals[secondOriginal.versionId].status).toBe("current");
    expect(rolledBack.originals[firstOriginal.versionId]).toBeDefined();
    expect(rolledBack.optimized[firstOptimized.versionId]).toBeDefined();
  });

  it("keeps optimizer revisions coexisting", () => {
    const history = makeCurrentHistory();
    const original = Object.values(history.originals)[0];
    const firstOptimized = Object.values(history.optimized)[0];
    const secondOptimized = makeOptimized(original, {
      optimizerVersion: "0.36.0",
      optimizedSha256: OPT_B,
      status: "verified",
    });
    const withBoth = addOptimizedVersion(history, secondOptimized);
    expect(Object.keys(withBoth.optimized)).toHaveLength(2);
    expect(secondOptimized.optimizedKey).not.toBe(firstOptimized.optimizedKey);
    const selected = selectCurrentVersion(withBoth, "optimized", secondOptimized.versionId);
    expect(selected.currentOptimizedVersionId).toBe(secondOptimized.versionId);
    expect(selected.optimized[firstOptimized.versionId].status).toBe("superseded");
    expect(selected.optimized[secondOptimized.versionId].status).toBe("current");
  });

  it("selects current versions explicitly and deterministically", () => {
    const history = makeCurrentHistory();
    const original = Object.values(history.originals)[0];
    const second = makeOriginal({ sourceSha256: SHA_B, status: "verified" });
    const withSecond = addOriginalVersion(history, second);
    const secondOptimized = makeOptimized(second, { optimizedSha256: OPT_B, status: "verified" });
    const withBoth = addOptimizedVersion(withSecond, secondOptimized);
    const selected = rollbackToVersion(withBoth, second.versionId, secondOptimized.versionId);
    expect(selected.currentOriginalVersionId).toBe(second.versionId);
    expect(selected.originals[original.versionId].status).toBe("superseded");
    expect(selectCurrentVersion(selected, "original", second.versionId)).toBe(selected);
    expect(selected.originals[original.versionId].status).toBe("superseded");
  });

  it("does not expose historical versions through public URLs", () => {
    const history = makeCurrentHistory();
    const second = makeOriginal({ sourceSha256: SHA_B, status: "verified" });
    const withSecond = addOriginalVersion(history, second);
    const secondOptimized = makeOptimized(second, { optimizedSha256: OPT_B, status: "verified" });
    const withBoth = addOptimizedVersion(withSecond, secondOptimized);
    const map = buildVersionedMap([withBoth], "https://images.example.com/");
    const entry = map.entries.bugonia;
    expect(entry.originals).toHaveLength(2);
    expect(entry.optimized).toHaveLength(2);
    expect(toPublicVersionUrls(withBoth, "https://images.example.com/").original).toBe(
      `https://images.example.com/${entry.currentOriginal.originalKey}`,
    );
    expect(toPublicVersionUrls(withBoth, "https://images.example.com/").optimized).toBe(
      `https://images.example.com/${entry.currentOptimized.optimizedKey}`,
    );
    expect(entry.currentOriginal.versionId).toBe(Object.values(history.originals)[0].versionId);
  });

  it("rejects unverified versions as current", () => {
    const pending = makeOriginal({ status: "pending", verifiedAt: null });
    const history: PosterVersionHistory = {
      schemaVersion: 1,
      posterId: "bugonia",
      currentOriginalVersionId: null,
      currentOptimizedVersionId: null,
      originals: { [pending.versionId]: pending },
      optimized: {},
    };
    expect(() => selectCurrentVersion(history, "original", pending.versionId)).toThrow(
      VersioningError,
    );
  });

  it("rejects rollback to unverified versions", () => {
    const history = makeCurrentHistory();
    const pending = makeOriginal({ sourceSha256: SHA_B, status: "pending", verifiedAt: null });
    const withPending = addOriginalVersion(history, pending);
    const pendingOptimized = makeOptimized(pending, {
      optimizedSha256: OPT_B,
      status: "pending",
      verifiedAt: null,
    });
    const withBoth = addOptimizedVersion(withPending, pendingOptimized);
    expect(() =>
      rollbackToVersion(withBoth, pending.versionId, pendingOptimized.versionId),
    ).toThrow(VersioningError);
  });

  it("fails closed on duplicate current versions", () => {
    const first = makeOriginal({ status: "current" });
    const second = makeOriginal({ sourceSha256: SHA_B, status: "current" });
    const history: PosterVersionHistory = {
      schemaVersion: 1,
      posterId: "bugonia",
      currentOriginalVersionId: first.versionId,
      currentOptimizedVersionId: null,
      originals: { [first.versionId]: first, [second.versionId]: second },
      optimized: {},
    };
    expect(() => validateVersionHistory(history)).toThrow(/Multiple current/);
  });

  it("fails closed on a missing derivative", () => {
    const history = makeCurrentHistory();
    const withoutOptimized: PosterVersionHistory = {
      ...history,
      currentOptimizedVersionId: null,
      optimized: {},
    };
    expect(() => resolveCurrentVersion(withoutOptimized)).toThrow(VersioningError);
  });

  it("fails closed on corrupt current pointers", () => {
    const history = makeCurrentHistory();
    expect(() =>
      validateVersionHistory({
        ...history,
        currentOriginalVersionId: "missing",
      }),
    ).toThrow(VersioningError);
  });

  it("fails closed on wrong poster or variant metadata", () => {
    const history = makeCurrentHistory();
    const original = Object.values(history.originals)[0];
    const wrongPoster = makeOptimized(original, {
      posterId: "her",
      optimizedSha256: OPT_B,
      status: "verified",
    });
    expect(() => addOptimizedVersion(history, wrongPoster)).toThrow(VersioningError);
  });

  it("fails closed on duplicate version IDs and keys", () => {
    const history = makeCurrentHistory();
    const original = Object.values(history.originals)[0];
    const duplicate = { ...original, originalBytes: original.originalBytes + 1 };
    expect(() => addOriginalVersion(history, duplicate)).toThrow(VersioningError);
  });

  it("does not overwrite a verified version", () => {
    const history = makeCurrentHistory();
    const original = Object.values(history.originals)[0];
    const snapshot = structuredClone(original);
    const second = makeOriginal({ sourceSha256: SHA_B, status: "verified" });
    addOriginalVersion(history, second);
    expect(history.originals[original.versionId]).toEqual(snapshot);
  });

  it("rejects missing source versions for optimized derivatives", () => {
    const history = makeCurrentHistory();
    const optimized = Object.values(history.optimized)[0];
    const corrupt: PosterVersionHistory = {
      ...history,
      optimized: {
        ...history.optimized,
        [optimized.versionId]: { ...optimized, sourceVersionId: "missing" },
      },
    };
    expect(() => validateVersionHistory(corrupt)).toThrow(/missing source version/);
  });

  it("does not treat a verified historical version as current automatically", () => {
    const history = makeCurrentHistory();
    const second = makeOriginal({ sourceSha256: SHA_B, status: "verified" });
    const withSecond = addOriginalVersion(history, second);
    expect(withSecond.currentOriginalVersionId).toBe(Object.values(history.originals)[0].versionId);
    expect(withSecond.originals[second.versionId].status).toBe("verified");
  });

  it("marks incomplete histories as skipped in the versioned map", () => {
    const original = makeOriginal({ status: "verified" });
    const history: PosterVersionHistory = {
      schemaVersion: 1,
      posterId: "bugonia",
      currentOriginalVersionId: null,
      currentOptimizedVersionId: null,
      originals: { [original.versionId]: original },
      optimized: {},
    };
    const map = buildVersionedMap([history], "https://images.example.com");
    expect(map.entries.bugonia).toBeUndefined();
    expect(map.skipped).toHaveLength(1);
  });
});

describe("versioned migration plan", () => {
  const manifest = readJson<PosterManifest>("poster-manifest.json");
  const legacyKeys = Object.values(LEGACY_CANARY_KEYS).flatMap((entry) => [
    entry.original,
    entry.optimized,
  ]);
  function fixtureArtifacts(
    posterManifest: PosterManifest,
  ): Record<string, OptimizedArtifactMetadata> {
    const excluded = new Set(["2001-a-space-odyssey", "bugonia", "artwork-1824607248"]);
    const medium = new Set(["stranger-things-2", "the-substance-2"]);
    const result: Record<string, OptimizedArtifactMetadata> = {};
    for (const entry of posterManifest.entries) {
      if (
        entry.identityConfidence !== "high" ||
        excluded.has(entry.cineprintPosterId) ||
        medium.has(entry.cineprintPosterId) ||
        !entry.sourceSha256
      ) {
        continue;
      }
      result[entry.cineprintPosterId] = {
        posterId: entry.cineprintPosterId,
        sourceSha256: entry.sourceSha256,
        optimizedSha256: sha256Hex(
          Buffer.from(`fixture-optimized:${entry.cineprintPosterId}:${entry.sourceSha256}`),
        ),
        optimizedBytes: 1000 + entry.cineprintPosterId.length,
        width: 800,
        height: 800,
        mimeType: "image/webp",
        optimizer: OPTIMIZER,
        transformation: { width: 800, quality: 80, format: "webp" },
      };
    }
    return result;
  }
  const optimizedArtifacts = fixtureArtifacts(manifest);

  it("reports 58 eligible high-confidence posters and 116 new objects", () => {
    const plan = buildVersionedMigrationPlan(manifest, {
      optimizer: OPTIMIZER,
      legacyKeys,
      optimizedArtifacts,
    });
    expect(plan.summary).toMatchObject({
      eligible: 58,
      excluded: 5,
      newObjects: 116,
      totalHighConfidenceObjects: 122,
      localConflicts: 0,
      liveR2ChecksRequired: 58,
    });
    expect(plan.items).toHaveLength(58);
    expect(
      plan.items.every(
        (item) =>
          item.originalKey.startsWith("cineprint/versions/original/") &&
          item.optimizedKey.startsWith("cineprint/versions/optimized/"),
      ),
    ).toBe(true);
    expect(plan.items.every((item) => item.optimizerIdentityComplete)).toBe(true);
    expect(new Set(plan.items.map((item) => item.originalKey)).size).toBe(58);
    expect(new Set(plan.items.map((item) => item.optimizedKey)).size).toBe(58);
  });

  it("excludes the three canaries and the two medium identities", () => {
    const plan = buildVersionedMigrationPlan(manifest, {
      optimizer: OPTIMIZER,
      legacyKeys,
      optimizedArtifacts,
    });
    expect(
      plan.excluded.filter((entry) => entry.reason === "LEGACY_CANARY_PRESERVED"),
    ).toHaveLength(3);
    expect(
      plan.excluded.filter((entry) => entry.reason === "MEDIUM_IDENTITY_UNRESOLVED"),
    ).toHaveLength(2);
    expect(plan.excluded.map((entry) => entry.posterId)).toEqual(
      expect.arrayContaining([
        "2001-a-space-odyssey",
        "bugonia",
        "artwork-1824607248",
        "stranger-things-2",
        "the-substance-2",
      ]),
    );
  });

  it("fails closed on a local key conflict", () => {
    const eligible = manifest.entries.find(
      (entry) => entry.cineprintPosterId === "furiosa-a-mad-max-saga",
    )!;
    const plan = buildVersionedMigrationPlan(manifest, {
      optimizer: OPTIMIZER,
      legacyKeys: [originalVersionKey("furiosa-a-mad-max-saga", eligible.sourceSha256!, "png")],
      optimizedArtifacts,
    });
    expect(plan.summary.eligible).toBeLessThan(58);
    expect(plan.summary.localConflicts).toBeGreaterThan(0);
    expect(plan.excluded.some((entry) => entry.reason === "LOCAL_KEY_CONFLICT")).toBe(true);
  });

  it("uses deterministic version IDs and keys", () => {
    const first = buildVersionedMigrationPlan(manifest, {
      optimizer: OPTIMIZER,
      legacyKeys,
      optimizedArtifacts,
    });
    const second = buildVersionedMigrationPlan(manifest, {
      optimizer: OPTIMIZER,
      legacyKeys,
      optimizedArtifacts,
    });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("exposes the legacy canary URLs only through their current history", () => {
    const map = readJson<{
      publicBaseUrl: string;
      entries: Record<string, LegacyCanaryMapEntry>;
    }>("r2-image-map.json");
    const state = readJson<{ entries: Record<string, MigrationStateEntry> }>(
      "migration-state.json",
    );
    const histories = Object.keys(LEGACY_CANARY_KEYS).map((posterId) =>
      buildLegacyCanaryHistory({
        manifestEntry: manifest.entries.find(
          (entry) => entry.cineprintPosterId === posterId,
        ) as ManifestEntry,
        stateEntry: state.entries[posterId],
        mapEntry: map.entries[posterId],
      }),
    );
    const versionedMap = buildVersionedMap(histories, map.publicBaseUrl);
    expect(versionedMap.skipped).toEqual([]);
    for (const posterId of Object.keys(LEGACY_CANARY_KEYS)) {
      expect(versionedMap.entries[posterId].legacy).toBe(true);
      expect(versionedMap.entries[posterId].currentOriginal.originalKey).toBe(
        map.entries[posterId].original.key,
      );
      expect(versionedMap.entries[posterId].currentOptimized.optimizedKey).toBe(
        map.entries[posterId].optimized.key,
      );
    }
  });
});

describe("source version ID helpers", () => {
  it("is deterministic and distinct for distinct source hashes", () => {
    expect(sourceVersionId("bugonia", SHA_A)).toBe(
      "src-bugonia-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    expect(sourceVersionId("bugonia", SHA_B)).not.toBe(sourceVersionId("bugonia", SHA_A));
    expect(optimizedVersionId("bugonia", SHA_A, OPTIMIZER, 800, 80)).toBe(
      "opt-bugonia-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-sharp-0.35.3-libvips-8.18.3-w800-q80",
    );
    expect(legacyVersionId("bugonia", "original")).toBe("legacy-bugonia-original");
  });
});
