import { describe, expect, it } from "vitest";
import { R2_IMAGE_MAP } from "../src/lib/r2-image-map.generated";
import { createPosterImageResolver } from "../src/lib/poster-images";
import type { Poster } from "../src/lib/posters";

const CANARY_IDS = ["2001-a-space-odyssey", "bugonia", "artwork-1824607248"];
const FULL_IDS = Object.keys(R2_IMAGE_MAP).sort();

const canaryMap = Object.fromEntries(CANARY_IDS.map((id) => [id, R2_IMAGE_MAP[id]]));
const invalidMap = {
  ...R2_IMAGE_MAP,
  "2001-a-space-odyssey": {
    ...R2_IMAGE_MAP["2001-a-space-odyssey"],
    optimizedUrl: "not-a-url",
  },
};

function resolverFor(map: typeof R2_IMAGE_MAP) {
  return createPosterImageResolver(map, {
    browserEnabled: true,
    seoEnabled: false,
    downloadsEnabled: false,
  });
}

function posterFor(id: string): Poster {
  const entry = R2_IMAGE_MAP[id];
  return {
    id,
    title: id,
    year: 0,
    artist: "",
    source: "",
    sourceUrl: "",
    image: entry.blobImageUrl,
    style: "Minimalist",
    genre: [],
    tags: [],
  };
}

describe("F29 — local rollback simulation", () => {
  it("starts from a known-good canary-only map", () => {
    const resolver = resolverFor(canaryMap);
    for (const id of CANARY_IDS) {
      expect(resolver.getPosterImageUrl(posterFor(id), "gallery")).toBe(
        R2_IMAGE_MAP[id].optimizedUrl,
      );
    }
    const migrated = FULL_IDS.find((id) => !CANARY_IDS.includes(id))!;
    expect(resolver.getPosterImageUrl(posterFor(migrated), "gallery")).not.toMatch(
      /^https:\/\/images\.cineprint\.click\//,
    );
  });

  it("switches to the full 61-entry map with no Blob candidates", () => {
    const resolver = resolverFor(R2_IMAGE_MAP);
    for (const id of FULL_IDS) {
      const candidates = resolver.getPosterImageCandidates(posterFor(id), "gallery");
      expect(candidates).toEqual([R2_IMAGE_MAP[id].optimizedUrl, R2_IMAGE_MAP[id].originalUrl]);
      expect(candidates.some((url) => url.includes("public.blob.vercel-storage.com"))).toBe(false);
    }
  });

  it("fails closed when the active map entry is malformed", () => {
    const resolver = resolverFor(invalidMap as typeof R2_IMAGE_MAP);
    const poster = posterFor("2001-a-space-odyssey");
    expect(resolver.getPosterImageCandidates(poster, "gallery")).toEqual([]);
    expect(resolver.getPosterImageCandidates(poster, "original")).toEqual([]);
  });

  it("restores the known-good map deterministically", () => {
    const before = resolverFor(canaryMap);
    const first = CANARY_IDS.map((id) => before.getPosterImageCandidates(posterFor(id), "gallery"));

    // Simulate a full-map rollout followed by a failed map and a rollback.
    resolverFor(R2_IMAGE_MAP);
    resolverFor(invalidMap as typeof R2_IMAGE_MAP);
    const restored = resolverFor(canaryMap);
    const second = CANARY_IDS.map((id) =>
      restored.getPosterImageCandidates(posterFor(id), "gallery"),
    );

    expect(second).toEqual(first);
  });

  it("keeps repeated map switching deterministic", () => {
    const sample = ["2001-a-space-odyssey", "art-of-a-hit-2024", "the-woman-who-ran"];
    const run = () => {
      const canary = resolverFor(canaryMap);
      const full = resolverFor(R2_IMAGE_MAP);
      return sample.map((id) => ({
        canary: canary.getPosterImageUrl(posterFor(id), "gallery"),
        full: full.getPosterImageUrl(posterFor(id), "gallery"),
      }));
    };
    expect(run()).toEqual(run());
  });
});
