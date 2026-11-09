import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "./checksum";
import { R2_CACHE_CONTROL, R2InconclusiveError } from "./r2";
import {
  buildPreflightExpectations,
  classifyPreflightMetadata,
  runPreflight,
  summarizePreflight,
  validatePreflightPlan,
} from "./preflight";
import {
  LEGACY_CANARY_KEYS,
  buildVersionedMigrationPlan,
  optimizerSlug,
  type LegacyCanaryMapEntry,
  type OptimizedArtifactMetadata,
  type OptimizerIdentity,
} from "./versioning";
import type { MigrationStateEntry, PosterManifest, R2ObjectMetadata, R2Store } from "./types";

const OPTIMIZER: OptimizerIdentity = {
  name: "sharp",
  version: "0.35.3",
  libvipsVersion: "8.18.3",
};

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), "migration", file), "utf8")) as T;
}

const manifest = readJson<PosterManifest>("poster-manifest.json");
const state = readJson<{ entries: Record<string, MigrationStateEntry> }>("migration-state.json");
const map = readJson<{
  publicBaseUrl: string;
  entries: Record<string, LegacyCanaryMapEntry>;
}>("r2-image-map.json");

const legacyKeys = Object.values(LEGACY_CANARY_KEYS).flatMap((keys) => [
  keys.original,
  keys.optimized,
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

const plan = buildVersionedMigrationPlan(manifest, {
  optimizer: OPTIMIZER,
  legacyKeys,
  optimizedArtifacts: fixtureArtifacts(manifest),
});
const expectations = buildPreflightExpectations(manifest, plan);

function matchingMetadata(expectation: (typeof expectations)[number]): R2ObjectMetadata {
  const userMetadata: Record<string, string> = {};
  for (const [key, value] of Object.entries(expectation.requiredUserMetadata)) {
    userMetadata[key] = value ?? (key === "sha256" ? "b".repeat(64) : "unknown");
  }
  return {
    key: expectation.key,
    size: expectation.sizeBytes ?? 1234,
    contentType: expectation.contentType,
    cacheControl: expectation.cacheControl,
    checksumSha256: expectation.sha256
      ? Buffer.from(expectation.sha256, "hex").toString("base64")
      : null,
    metadataSha256: expectation.sha256,
    userMetadata,
    etag: '"etag"',
  };
}

function mockStore(
  handler: (key: string) => Promise<R2ObjectMetadata | null>,
): R2Store & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async head(key: string) {
      calls.push(key);
      return handler(key);
    },
    async verifyOrigin() {
      throw new Error("not used");
    },
    async put() {
      throw new Error("not used");
    },
    async verify() {
      throw new Error("not used");
    },
    async publicVerify() {
      throw new Error("not used");
    },
  };
}

function baseOptions() {
  return {
    manifest,
    plan,
    optimizer: OPTIMIZER,
    stateEntries: state.entries,
    mapEntries: map.entries,
    publicBaseUrl: map.publicBaseUrl,
  };
}

describe("F18 — pre-flight plan validation", () => {
  it("enumerates exactly 116 planned keys for 58 eligible posters", () => {
    expect(plan.summary.eligible).toBe(58);
    expect(expectations).toHaveLength(116);
    expect(new Set(expectations.map((entry) => entry.key)).size).toBe(116);
    expect(
      expectations.every(
        (entry) =>
          entry.key.startsWith("cineprint/versions/original/") ||
          entry.key.startsWith("cineprint/versions/optimized/"),
      ),
    ).toBe(true);
  });

  it("uses the full SHA-256 in every planned key", () => {
    for (const expectation of expectations) {
      expect(expectation.key).toContain(expectation.sha256!);
    }
    const optimized = expectations.filter((item) => item.variant === "optimized");
    expect(
      optimized.every((item) => item.sha256 !== item.requiredUserMetadata["source-sha256"]),
    ).toBe(true);
  });

  it("never includes the six legacy canary keys", () => {
    const canaryKeys = new Set(
      Object.values(LEGACY_CANARY_KEYS).flatMap((keys) => [keys.original, keys.optimized]),
    );
    expect(expectations.some((entry) => canaryKeys.has(entry.key))).toBe(false);
  });

  it("preserves the canary keys, state and map URLs", () => {
    const validation = validatePreflightPlan({
      ...baseOptions(),
      expectations,
    });
    expect(validation.ok).toBe(true);
    expect(validation.canaryKeysExcluded).toBe(true);
    expect(validation.canaryUrlsMatch).toBe(true);
  });

  it("fails closed on duplicate planned keys", () => {
    const duplicated = [...expectations, expectations[0]];
    const validation = validatePreflightPlan({
      ...baseOptions(),
      expectations: duplicated,
    });
    expect(validation.ok).toBe(false);
    expect(validation.duplicateKeys).toContain(expectations[0].key);
    expect(validation.errors.join(" ")).toMatch(/Duplicate planned keys/);
  });
});

describe("F18 — local mode makes no bucket claim and no request", () => {
  it("reports 116 UNKNOWN results and blocks uploads", async () => {
    const store = mockStore(async () => null);
    const report = await runPreflight({ ...baseOptions(), mode: "local", store });
    expect(report.results).toHaveLength(116);
    expect(report.results.every((result) => result.classification === "UNKNOWN")).toBe(true);
    expect(report.results.every((result) => result.evidence === "LOCAL_PLAN_ONLY")).toBe(true);
    expect(report.summary.complete).toBe(false);
    expect(report.summary.blocksUpload).toBe(true);
    expect(report.liveEvidence.performed).toBe(false);
    expect(report.liveEvidence.headRequests).toBe(0);
    expect(store.calls).toHaveLength(0);
  });

  it("refuses live mode without explicit authorization", async () => {
    await expect(
      runPreflight({ ...baseOptions(), mode: "live", store: mockStore(async () => null) }),
    ).rejects.toThrow(/explicit authorization/);
  });

  it("refuses live mode without a store", async () => {
    await expect(
      runPreflight({ ...baseOptions(), mode: "live", allowLiveHead: true }),
    ).rejects.toThrow(/requires an R2 store/);
  });
});

describe("F18 — live classifications", () => {
  it("classifies 116 absent keys conclusively", async () => {
    const store = mockStore(async () => null);
    const report = await runPreflight({
      ...baseOptions(),
      mode: "live",
      store,
      allowLiveHead: true,
    });
    expect(report.summary.absent).toBe(116);
    expect(report.summary.complete).toBe(true);
    expect(report.summary.blocksUpload).toBe(false);
    expect(report.liveEvidence.headRequests).toBe(116);
    expect(store.calls).toHaveLength(116);
  });

  it("classifies matching and mismatching existing objects", async () => {
    const original = expectations.find((entry) => entry.variant === "original")!;
    const optimized = expectations.find((entry) => entry.variant === "optimized")!;
    const store = mockStore(async (key) => {
      if (key === original.key) return matchingMetadata(original);
      if (key === optimized.key) {
        return {
          ...matchingMetadata(optimized),
          userMetadata: { ...matchingMetadata(optimized).userMetadata, "poster-id": "wrong" },
        };
      }
      return null;
    });
    const report = await runPreflight({
      ...baseOptions(),
      mode: "live",
      store,
      allowLiveHead: true,
    });
    expect(report.summary.existsMatch).toBe(1);
    expect(report.summary.existsMismatch).toBe(1);
    expect(report.summary.absent).toBe(114);
    expect(report.summary.complete).toBe(true);
    expect(report.summary.blocksUpload).toBe(true);
  });

  it("classifies a timeout as UNKNOWN and an unexpected error as ERROR", async () => {
    const [first, second] = expectations;
    const store = mockStore(async (key) => {
      if (key === first.key) throw new R2InconclusiveError("HeadObject timed out");
      if (key === second.key) throw new Error("access denied");
      return null;
    });
    const report = await runPreflight({
      ...baseOptions(),
      mode: "live",
      store,
      allowLiveHead: true,
      headTimeoutMs: 50,
    });
    expect(report.summary.unknown).toBe(1);
    expect(report.summary.error).toBe(1);
    expect(report.summary.complete).toBe(false);
    expect(report.summary.blocksUpload).toBe(true);
    expect(report.results.find((result) => result.key === first.key)?.classification).toBe(
      "UNKNOWN",
    );
    expect(report.results.find((result) => result.key === second.key)?.classification).toBe(
      "ERROR",
    );
  });

  it("aborts a hung HeadObject at the configured timeout", async () => {
    const store = mockStore(
      (key) =>
        new Promise((_resolve, reject) => {
          void key;
          setTimeout(() => reject(new R2InconclusiveError("late")), 10_000);
        }),
    );
    const started = Date.now();
    const report = await runPreflight({
      ...baseOptions(),
      mode: "live",
      store,
      allowLiveHead: true,
      headTimeoutMs: 25,
      concurrency: 16,
    });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(report.summary.unknown).toBe(116);
    expect(report.summary.complete).toBe(false);
  });

  it("treats an incomplete result set as blocking", () => {
    const results = Array.from({ length: 115 }, (_, index) => ({
      posterId: expectations[index].posterId,
      variant: expectations[index].variant,
      key: expectations[index].key,
      versionId: expectations[index].versionId,
      classification: "ABSENT" as const,
      evidence: "LIVE_HEAD" as const,
      reason: "absent",
      checks: [],
      metadata: null,
      limitations: [],
    }));
    const summary = summarizePreflight(results, true, true, 116);
    expect(summary.complete).toBe(false);
    expect(summary.blocksUpload).toBe(true);
  });
});

describe("F18 — metadata comparison", () => {
  const original = expectations.find((entry) => entry.variant === "original")!;
  const optimized = expectations.find((entry) => entry.variant === "optimized")!;

  it("accepts a complete original object", () => {
    const result = classifyPreflightMetadata(original, matchingMetadata(original));
    expect(result.classification).toBe("EXISTS_MATCH");
  });

  it("fails closed on an optimized object whose bytes cannot be confirmed yet", () => {
    const result = classifyPreflightMetadata(optimized, matchingMetadata(optimized));
    expect(result.classification).toBe("UNKNOWN");
    expect(result.reason).toMatch(/inconclusive/);
  });

  it("rejects a wrong Content-Type", () => {
    const result = classifyPreflightMetadata(original, {
      ...matchingMetadata(original),
      contentType: "image/jpeg",
    });
    expect(result.classification).toBe("EXISTS_MISMATCH");
    expect(result.reason).toMatch(/content-type/);
  });

  it("rejects a wrong content length", () => {
    const result = classifyPreflightMetadata(original, {
      ...matchingMetadata(original),
      size: (original.sizeBytes ?? 0) + 1,
    });
    expect(result.classification).toBe("EXISTS_MISMATCH");
    expect(result.reason).toMatch(/content-length/);
  });

  it("rejects a wrong checksum", () => {
    const result = classifyPreflightMetadata(original, {
      ...matchingMetadata(original),
      metadataSha256: "f".repeat(64),
      checksumSha256: null,
    });
    expect(result.classification).toBe("EXISTS_MISMATCH");
    expect(result.reason).toMatch(/sha256/);
  });

  it("rejects missing immutable Cache-Control", () => {
    const result = classifyPreflightMetadata(original, {
      ...matchingMetadata(original),
      cacheControl: null,
    });
    expect(result.classification).toBe("EXISTS_MISMATCH");
    expect(result.reason).toMatch(/cache-control/);
  });

  it("rejects an optimized object without optimizer provenance", () => {
    const metadata = matchingMetadata(optimized);
    const userMetadata = { ...metadata.userMetadata };
    delete userMetadata.optimizer;
    const result = classifyPreflightMetadata(optimized, { ...metadata, userMetadata });
    expect(result.classification).toBe("EXISTS_MISMATCH");
    expect(result.reason).toMatch(/metadata:optimizer/);
  });

  it("rejects an optimized object that declares no checksum", () => {
    const metadata = matchingMetadata(optimized);
    const userMetadata = { ...metadata.userMetadata };
    delete userMetadata.sha256;
    const result = classifyPreflightMetadata(optimized, { ...metadata, userMetadata });
    expect(result.classification).toBe("EXISTS_MISMATCH");
    expect(result.reason).toMatch(/sha256/);
  });

  it("uses the optimizer slug expected by the final key convention", () => {
    expect(optimized.requiredUserMetadata.optimizer).toBe(optimizerSlug(OPTIMIZER));
    expect(original.cacheControl).toBe(R2_CACHE_CONTROL);
  });
});
