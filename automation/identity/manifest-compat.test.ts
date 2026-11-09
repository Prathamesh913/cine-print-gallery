import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildSyncPlan } from "../../scripts/poster-identity.js";
import { parsePageData } from "../../scripts/sync-notion-to-firestore.js";
import { createPosterImageResolver } from "../../src/lib/poster-images";
import { R2_IMAGE_MAP } from "../../src/lib/r2-image-map.generated";
import type { Poster } from "../../src/lib/posters";
import { buildPostBackfillFixture, loadManifest, loadMigrationState, loadR2Map } from "./fixtures";

const CANARIES = ["2001-a-space-odyssey", "bugonia", "artwork-1824607248"];

const R2_KEYS = [
  "cineprint/raindrop/1528361110.png",
  "cineprint/optimized/legacy/2001-a-space-odyssey.webp",
  "cineprint/external/bugonia.jpg",
  "cineprint/optimized/external/bugonia.webp",
  "cineprint/raindrop/1824607248.jpg",
  "cineprint/optimized/1824607248.webp",
];

function plan() {
  const fixture = buildPostBackfillFixture();
  return buildSyncPlan({
    ...fixture,
    parsePage: parsePageData,
    mode: "canonical",
    allowLegacy: false,
  });
}

describe("manifest and R2 compatibility", () => {
  it("keeps every manifest ID stable", () => {
    const manifest = loadManifest();
    const manifestIds = manifest.entries.map((entry) => entry.cineprintPosterId).sort();
    const planIds = plan()
      .records.map((record) => record.id)
      .sort();
    expect(planIds).toEqual(manifestIds);
    expect(manifestIds).toHaveLength(63);
    expect(new Set(manifestIds).size).toBe(63);
  });

  it("keeps the three canary IDs exact", () => {
    const planIds = new Set(plan().records.map((record) => record.id));
    for (const canary of CANARIES) expect(planIds.has(canary)).toBe(true);
  });

  it("keeps the canary mappings while allowing the migrated map", () => {
    const map = loadR2Map();
    expect(Object.keys(map.entries)).toHaveLength(61);
    for (const canary of CANARIES) {
      expect(map.entries[canary].posterId).toBe(canary);
    }
    expect(map.entries["stranger-things-2"]).toBeUndefined();
    expect(map.entries["the-substance-2"]).toBeUndefined();
  });

  it("keeps the allowlist expanded but excludes medium identities", () => {
    const allowlist = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "migration", "r2-resolver-allowlist.json"), "utf8"),
    );
    expect(allowlist.posters).toHaveLength(61);
    expect(new Set(allowlist.posters).size).toBe(61);
    for (const canary of CANARIES) expect(allowlist.posters).toContain(canary);
    expect(allowlist.posters).not.toContain("stranger-things-2");
    expect(allowlist.posters).not.toContain("the-substance-2");
  });

  it("keeps the six canary R2 keys and the three verified canary state entries", () => {
    const map = loadR2Map();
    const state = loadMigrationState();
    const keys = new Set<string>();
    for (const entry of Object.values(map.entries)) {
      keys.add(entry.original.key);
      keys.add(entry.optimized.key);
    }
    for (const key of R2_KEYS) expect(keys.has(key)).toBe(true);
    expect(Object.keys(state.entries).sort()).toEqual([...CANARIES].sort());
    for (const canary of CANARIES) {
      expect(state.entries[canary].state).toBe("VERIFIED");
    }
  });

  it("does not let identity code import or write R2", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "scripts", "poster-identity.js"),
      "utf8",
    );
    expect(source).not.toContain("@aws-sdk");
    expect(source).not.toContain("PutObject");
    expect(source).not.toContain("R2_");
    expect(source).not.toContain("r2-image-map");
  });

  it("does not let a changed image URL silently reuse an old R2 mapping", () => {
    const resolver = createPosterImageResolver(R2_IMAGE_MAP, {
      browserEnabled: true,
      seoEnabled: false,
      downloadsEnabled: false,
    });
    const poster: Poster = {
      id: "bugonia",
      title: "Bugonia",
      year: 2025,
      artist: "Lydia Maltby",
      source: "Source",
      sourceUrl: "https://example.com/source",
      image:
        "https://csfzm0ozakaiii5u.public.blob.vercel-storage.com/cineprint/external/bugonia.jpg",
      style: "Minimalist",
      genre: [],
      tags: [],
    };
    expect(resolver.getPosterImageUrl(poster, "gallery")).toBe(
      "https://images.cineprint.click/cineprint/optimized/external/bugonia.webp",
    );

    const changed: Poster = {
      ...poster,
      image:
        "https://csfzm0ozakaiii5u.public.blob.vercel-storage.com/cineprint/external/bugonia-v2.jpg",
    };
    expect(resolver.getPosterImageUrl(changed, "gallery")).toBe(changed.image);
    expect(resolver.getPosterImageCandidates(changed, "gallery")).toEqual([changed.image]);
  });
});
