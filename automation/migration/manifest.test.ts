import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

interface ManifestEntry {
  cineprintPosterId: string;
  notionPageId: string;
  notionTitle: string;
  notionDerivedId: string | null;
  identityReconciled: boolean;
  raindropId: string | null;
  raindropCollectionId: number | null;
  sourceProvider: "raindrop-file" | "pbs-twimg" | "unknown";
  sourceImageUrl: string | null;
  sourceAvailability: "available" | "unavailable" | "unknown";
  sourceHttpStatus: number | null;
  sourceMimeType: string | null;
  sourceDimensions: { width: number; height: number } | null;
  sourceSizeBytes: number | null;
  sourceSha256: string | null;
  sourceMatchesExistingOriginal: boolean | null;
  currentImageUrl: string;
  currentImageObjectKey: string | null;
  originalR2Key: string | null;
  optimizedR2Key: string | null;
  identityMatchMethod: string;
  identityConfidence: "high" | "medium" | "low" | "none";
  migrationStatus: string;
  optimizedAction: "reuse-existing" | "regenerate";
  optimizedCurrentlyUnused: boolean;
}

interface Manifest {
  schemaVersion: number;
  generatedAt: string;
  baselineCommit: string;
  sourceCommit: string;
  counts: Record<string, number>;
  coverage: Record<string, string>;
  dryRunValidation: {
    manifestEntries: number;
    firestoreDocuments: number;
    idsMatch: boolean;
    missingFromManifest: string[];
    extraInManifest: string[];
    notionPageIdMismatches: string[];
    currentImageUrlMismatches: string[];
    notionDerivedIdMismatches: string[];
    sourceAvailable: number;
    sourceUnavailable: number;
    optimizedExisting: number;
    optimizedMissing: number;
    checks: Record<string, boolean>;
  };
  sourceProviders: Record<string, number>;
  identityMethods: Record<string, number>;
  migrationStatusCounts: Record<string, number>;
  duplicates: Record<string, Array<{ key: string; ids: string[] }>>;
  ambiguities: Array<{ cineprintPosterId: string; identityConfidence: string }>;
  multiImagePages: Array<{
    notionPageId: string;
    imageCount: number;
    posterIds: string[];
  }>;
  optimized: {
    existing: number;
    missing: number;
    missingPosterIds: string[];
    unusedExternalPosterIds: string[];
    byKind: Record<string, number>;
    existingByKind: Record<string, number>;
    missingByKind: Record<string, number>;
  };
  entries: ManifestEntry[];
}

interface Snapshot {
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

const root = process.cwd();
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, "migration", "poster-manifest.json"), "utf8"),
) as Manifest;
const snapshot = JSON.parse(
  fs.readFileSync(path.join(root, "migration", "firestore-identities.json"), "utf8"),
) as Snapshot;

const snapshotById = new Map(snapshot.documents.map((doc) => [doc.id, doc]));

describe("CinePrint poster migration manifest", () => {
  it("contains exactly the current 63 Firestore identities", () => {
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.counts.firestoreDocuments).toBe(63);
    expect(manifest.counts.manifestEntries).toBe(63);
    expect(snapshot.count).toBe(63);
    expect(manifest.entries).toHaveLength(63);
    expect(snapshot.documents).toHaveLength(63);

    const manifestIds = manifest.entries.map((entry) => entry.cineprintPosterId).sort();
    const snapshotIds = snapshot.documents.map((doc) => doc.id).sort();

    expect(new Set(manifestIds).size).toBe(63);
    expect(manifestIds).toEqual(snapshotIds);
    expect(manifest.coverage.firestoreIdsPreserved).toBe("63/63");
  });

  it("preserves every Firestore document ID without deriving a replacement", () => {
    for (const entry of manifest.entries) {
      const doc = snapshotById.get(entry.cineprintPosterId);
      expect(doc, `missing snapshot document ${entry.cineprintPosterId}`).toBeDefined();
      expect(entry.notionDerivedId).toBe(entry.cineprintPosterId);
      expect(entry.identityReconciled).toBe(true);
      expect(entry.notionPageId).toBe(doc!.notionPageId);
      expect(entry.currentImageUrl).toBe(doc!.image);
    }
  });

  it("reconciles every poster to a source and records full source metadata", () => {
    expect(manifest.coverage.identity).toBe("63/63");
    expect(manifest.coverage.source).toBe("63/63");
    expect(manifest.counts.sourceAvailable).toBe(63);
    expect(manifest.counts.sourceUnavailable).toBe(0);

    for (const entry of manifest.entries) {
      expect(entry.raindropId, `missing Raindrop ID for ${entry.cineprintPosterId}`).toBeTruthy();
      expect(entry.raindropCollectionId).toBeTypeOf("number");
      expect(entry.sourceImageUrl, `missing source URL for ${entry.cineprintPosterId}`).toBeTruthy();
      expect(entry.sourceAvailability).toBe("available");
      expect([200, 206]).toContain(entry.sourceHttpStatus);
      expect(entry.sourceMimeType).toMatch(/^image\//);
      expect(entry.sourceDimensions?.width).toBeGreaterThan(0);
      expect(entry.sourceDimensions?.height).toBeGreaterThan(0);
      expect(entry.sourceSizeBytes).toBeGreaterThan(0);
      expect(entry.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(entry.sourceMatchesExistingOriginal).toBe(true);
      expect(entry.identityMatchMethod).not.toBe("unmatched");
      expect(["high", "medium"]).toContain(entry.identityConfidence);
      expect(["READY_TO_COPY", "READY_WITH_REVIEW"]).toContain(entry.migrationStatus);
    }
  });

  it("records unique source URLs, Raindrop IDs and SHA-256 values", () => {
    const sourceUrls = manifest.entries.map((entry) => entry.sourceImageUrl).filter(Boolean);
    const raindropIds = manifest.entries.map((entry) => entry.raindropId).filter(Boolean);
    const hashes = manifest.entries.map((entry) => entry.sourceSha256).filter(Boolean);

    expect(new Set(sourceUrls).size).toBe(63);
    expect(new Set(raindropIds).size).toBe(63);
    expect(new Set(hashes).size).toBe(63);
    expect(manifest.duplicates.sourceImageUrls).toEqual([]);
    expect(manifest.duplicates.raindropIds).toEqual([]);
    expect(manifest.duplicates.originalR2Keys).toEqual([]);
    expect(manifest.duplicates.optimizedR2Keys).toEqual([]);
    expect(manifest.duplicates.currentImageUrls).toEqual([]);
  });

  it("uses the existing R2 object-key conventions", () => {
    for (const entry of manifest.entries) {
      expect(entry.originalR2Key).toBe(entry.currentImageObjectKey);
      expect(entry.originalR2Key).toMatch(/^cineprint\/(raindrop|external)\//);
      expect(entry.optimizedR2Key).toMatch(/^cineprint\/optimized\//);

      if (entry.cineprintPosterId.startsWith("artwork-")) {
        expect(entry.optimizedR2Key).toBe(`cineprint/optimized/${entry.raindropId}.webp`);
      } else if (entry.originalR2Key?.startsWith("cineprint/external/")) {
        expect(entry.optimizedR2Key).toBe(
          `cineprint/optimized/external/${entry.cineprintPosterId}.webp`,
        );
      } else {
        expect(entry.optimizedR2Key).toBe(
          `cineprint/optimized/legacy/${entry.cineprintPosterId}.webp`,
        );
      }
    }
  });

  it("records the expected source-provider split", () => {
    expect(manifest.sourceProviders["raindrop-file"]).toBe(31);
    expect(manifest.sourceProviders["pbs-twimg"]).toBe(32);
    expect(manifest.sourceProviders.unknown).toBe(0);

    for (const entry of manifest.entries) {
      if (entry.sourceProvider === "raindrop-file") {
        expect(entry.sourceImageUrl).toMatch(
          /^https:\/\/api\.raindrop\.io\/rest\/v1\/raindrop\/\d+\/file$/,
        );
      } else {
        expect(entry.sourceProvider).toBe("pbs-twimg");
        expect(entry.sourceImageUrl).toMatch(/^https:\/\/pbs\.twimg\.com\//);
      }
    }
  });

  it("classifies the two multi-image external matches as review-required", () => {
    expect(manifest.counts.highConfidence).toBe(61);
    expect(manifest.counts.mediumConfidence).toBe(2);
    expect(manifest.counts.lowConfidence).toBe(0);
    expect(manifest.counts.noneConfidence).toBe(0);
    expect(manifest.migrationStatusCounts.READY_TO_COPY).toBe(61);
    expect(manifest.migrationStatusCounts.READY_WITH_REVIEW).toBe(2);

    expect(manifest.ambiguities).toHaveLength(2);
    expect(manifest.ambiguities.map((entry) => entry.cineprintPosterId).sort()).toEqual([
      "stranger-things-2",
      "the-substance-2",
    ]);
    expect(manifest.ambiguities.every((entry) => entry.identityConfidence === "medium")).toBe(true);
  });

  it("keeps multi-image Notion pages as multiple poster entries", () => {
    expect(manifest.multiImagePages).toHaveLength(5);
    expect(manifest.multiImagePages.reduce((sum, page) => sum + page.posterIds.length, 0)).toBe(12);
    expect(manifest.multiImagePages.every((page) => page.imageCount > 1)).toBe(true);
    expect(manifest.multiImagePages.every((page) => new Set(page.posterIds).size === page.posterIds.length)).toBe(true);
  });

  it("records existing and missing optimized variants", () => {
    expect(manifest.optimized.existing).toBe(51);
    expect(manifest.optimized.missing).toBe(12);
    expect(manifest.counts.optimizedExisting).toBe(51);
    expect(manifest.counts.optimizedMissing).toBe(12);
    expect(manifest.optimized.missingPosterIds).toHaveLength(12);
    expect(manifest.optimized.unusedExternalPosterIds).toHaveLength(19);
    expect(manifest.optimized.byKind).toEqual({ legacy: 30, external: 19, artwork: 14 });
    expect(manifest.optimized.existingByKind).toEqual({ legacy: 30, external: 19, artwork: 2 });
    expect(manifest.optimized.missingByKind).toEqual({ legacy: 0, external: 0, artwork: 12 });

    const regenerated = manifest.entries.filter((entry) => entry.optimizedAction === "regenerate");
    expect(regenerated).toHaveLength(12);
    expect(regenerated.map((entry) => entry.cineprintPosterId).sort()).toEqual(
      [...manifest.optimized.missingPosterIds].sort(),
    );
    expect(regenerated.every((entry) => entry.cineprintPosterId.startsWith("artwork-"))).toBe(true);
  });

  it("includes a passing dry-run identity validation", () => {
    expect(manifest.dryRunValidation.manifestEntries).toBe(63);
    expect(manifest.dryRunValidation.firestoreDocuments).toBe(63);
    expect(manifest.dryRunValidation.idsMatch).toBe(true);
    expect(manifest.dryRunValidation.missingFromManifest).toEqual([]);
    expect(manifest.dryRunValidation.extraInManifest).toEqual([]);
    expect(manifest.dryRunValidation.notionPageIdMismatches).toEqual([]);
    expect(manifest.dryRunValidation.currentImageUrlMismatches).toEqual([]);
    expect(manifest.dryRunValidation.notionDerivedIdMismatches).toEqual([]);
    expect(manifest.dryRunValidation.sourceAvailable).toBe(63);
    expect(manifest.dryRunValidation.sourceUnavailable).toBe(0);
    expect(manifest.dryRunValidation.optimizedExisting).toBe(51);
    expect(manifest.dryRunValidation.optimizedMissing).toBe(12);
    expect(Object.values(manifest.dryRunValidation.checks).every(Boolean)).toBe(true);
  });

  it("contains no ambiguous or failed source mappings", () => {
    expect(manifest.entries.every((entry) => entry.sourceAvailability === "available")).toBe(true);
    expect(manifest.entries.every((entry) => entry.sourceSha256 !== null)).toBe(true);
    expect(manifest.entries.every((entry) => entry.sourceDimensions !== null)).toBe(true);
    expect(manifest.entries.every((entry) => entry.originalR2Key !== null)).toBe(true);
    expect(manifest.entries.every((entry) => entry.optimizedR2Key !== null)).toBe(true);
  });
});
