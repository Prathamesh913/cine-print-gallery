import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Poster } from "../src/lib/posters";
import { createPosterImageResolver } from "../src/lib/poster-images";
import { artistHeadMeta, posterHeadMeta } from "../src/lib/seo";
import { posterPageEntities } from "../src/lib/structured-data";
import { posterUrlEntries } from "../src/lib/sitemap";
import {
  R2_BROWSER_IMAGES_ENABLED,
  R2_IMAGE_MAP,
  R2_SEO_IMAGES_ENABLED,
} from "../src/lib/r2-image-map.generated";
import {
  R2_BROWSER_IMAGES_ENABLED as ACTIVE_BROWSER_IMAGES_ENABLED,
  R2_DOWNLOADS_ENABLED,
  R2_SEO_IMAGES_ENABLED as ACTIVE_SEO_IMAGES_ENABLED,
} from "../src/lib/r2-image-activation";
import { manifestHash } from "./migration/manifest";
import {
  buildR2ImageMap,
  R2_PUBLIC_BASE_URL,
  type R2ImageMapFile,
} from "../scripts/export-r2-verified-mappings";
import {
  buildRuntimeMapSource,
  checkRuntimeMap,
  generateRuntimeMap,
  validateR2ImageMap,
} from "../scripts/generate-r2-image-map";

const ROOT = path.resolve(__dirname, "..");
const MANIFEST_PATH = path.join(ROOT, "migration", "poster-manifest.json");
const STATE_PATH = path.join(ROOT, "migration", "migration-state.json");
const ALLOWLIST_PATH = path.join(ROOT, "migration", "r2-resolver-allowlist.json");

const CANARY_IDS = ["2001-a-space-odyssey", "bugonia", "artwork-1824607248"] as const;

const MEDIUM_IDS = ["stranger-things-2", "the-substance-2"] as const;

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cineprint-r2-map-test-"));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function writeJson(name: string, value: unknown): string {
  const filePath = path.join(tempDir, name);
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return filePath;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function exportWith(overrides: {
  manifest?: unknown;
  state?: unknown;
  allowlist?: unknown;
  publicBaseUrl?: string;
}): ReturnType<typeof buildR2ImageMap> {
  const manifestPath = overrides.manifest
    ? writeJson("manifest.json", overrides.manifest)
    : MANIFEST_PATH;
  const statePath = overrides.state ? writeJson("state.json", overrides.state) : STATE_PATH;
  const allowlistPath = writeJson("allowlist.json", overrides.allowlist ?? baseAllowlist());
  return buildR2ImageMap({
    manifestPath,
    statePath,
    allowlistPath,
    publicBaseUrl: overrides.publicBaseUrl,
    now: () => new Date("2026-11-07T15:00:00.000Z"),
  });
}

function baseManifest(): any {
  return readJson(MANIFEST_PATH);
}

function baseState(): any {
  return readJson(STATE_PATH);
}

function baseAllowlist(): any {
  return { schemaVersion: 1, posters: [...CANARY_IDS] };
}

function poster(overrides: Partial<Poster> = {}): Poster {
  return {
    id: "2001-a-space-odyssey",
    title: "2001: A Space Odyssey",
    year: 1968,
    artist: "Artist",
    source: "Source",
    sourceUrl: "https://example.com/source",
    image:
      "https://csfzm0ozakaiii5u.public.blob.vercel-storage.com/cineprint/raindrop/1528361110.png",
    style: "Minimalist",
    genre: [],
    tags: [],
    ...overrides,
  };
}

describe("R2 mapping exporter", () => {
  it("exports exactly the three allowlisted high-confidence VERIFIED entries", () => {
    const result = exportWith({});
    expect(Object.keys(result.map.entries).sort()).toEqual([...CANARY_IDS].sort());
    expect(result.map.schemaVersion).toBe(1);
    expect(result.map.publicBaseUrl).toBe(R2_PUBLIC_BASE_URL);
    expect(result.map.manifestHash).toHaveLength(64);
    expect(result.map.generatedAt).toBe("2026-11-07T15:00:00.000Z");

    for (const id of CANARY_IDS) {
      const entry = result.map.entries[id];
      expect(entry.posterId).toBe(id);
      expect(entry.blobImageUrl).toContain(".public.blob.vercel-storage.com/");
      expect(entry.original.url).toBe(`${R2_PUBLIC_BASE_URL}/${entry.original.key}`);
      expect(entry.optimized.url).toBe(`${R2_PUBLIC_BASE_URL}/${entry.optimized.key}`);
      expect(entry.original.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(entry.optimized.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(entry.optimized.contentType).toBe("image/webp");
    }
  });

  it("excludes medium-confidence entries", () => {
    const result = exportWith({});
    for (const id of MEDIUM_IDS) {
      expect(result.map.entries[id]).toBeUndefined();
    }
  });

  it("rejects a medium-confidence entry added to the allowlist (approvals are not consulted)", () => {
    const allowlist = baseAllowlist();
    allowlist.posters.push("stranger-things-2");
    expect(() => exportWith({ allowlist })).toThrow(/not high-confidence/);
  });

  it("rejects unknown allowlist IDs", () => {
    const allowlist = baseAllowlist();
    allowlist.posters.push("not-a-real-poster");
    expect(() => exportWith({ allowlist })).toThrow(/unknown poster ID/);
  });

  it("rejects a manifest hash mismatch", () => {
    const state = baseState();
    state.manifestHash = "0".repeat(64);
    expect(() => exportWith({ state })).toThrow(/manifestHash/);
  });

  it("rejects an original key mismatch", () => {
    const state = baseState();
    state.entries.bugonia.originalKey = "cineprint/external/other.jpg";
    expect(() => exportWith({ state })).toThrow(/originalKey/);
  });

  it("rejects an optimized key mismatch", () => {
    const state = baseState();
    state.entries.bugonia.optimizedKey = "cineprint/optimized/external/other.webp";
    expect(() => exportWith({ state })).toThrow(/optimizedKey/);
  });

  it("rejects an original checksum mismatch", () => {
    const state = baseState();
    state.entries.bugonia.originalSha256 = "f".repeat(64);
    expect(() => exportWith({ state })).toThrow(/originalSha256/);
  });

  it("rejects an original size mismatch", () => {
    const state = baseState();
    state.entries.bugonia.originalSizeBytes = 1;
    expect(() => exportWith({ state })).toThrow(/originalSizeBytes/);
  });

  it("rejects a missing optimized checksum", () => {
    const state = baseState();
    state.entries.bugonia.optimizedSha256 = null;
    expect(() => exportWith({ state })).toThrow(/optimizedSha256/);
  });

  it("rejects missing verification flags", () => {
    const state = baseState();
    state.entries.bugonia.originalUploaded = false;
    state.entries.bugonia.optimizedUploaded = false;
    expect(() => exportWith({ state })).toThrow(/originalUploaded must be true/);
  });

  it("rejects an unexpected R2 host", () => {
    expect(() => exportWith({ publicBaseUrl: "https://evil.example.com" })).toThrow(/host must be/);
  });

  it("rejects an invalid Blob image URL", () => {
    const manifest = baseManifest();
    const entry = manifest.entries.find(
      (candidate: any) => candidate.cineprintPosterId === "bugonia",
    );
    entry.currentImageUrl = "not-a-url";
    const state = baseState();
    state.manifestHash = manifestHash(manifest);
    expect(() => exportWith({ manifest, state })).toThrow(/Blob image URL/);
  });

  it("rejects an unsupported original Content-Type", () => {
    const manifest = baseManifest();
    const entry = manifest.entries.find(
      (candidate: any) => candidate.cineprintPosterId === "bugonia",
    );
    entry.sourceMimeType = "image/tiff";
    const state = baseState();
    state.manifestHash = manifestHash(manifest);
    expect(() => exportWith({ manifest, state })).toThrow(/unsupported original Content-Type/);
  });

  it("is deterministic for the same input and clock", () => {
    const first = exportWith({});
    const second = exportWith({});
    expect(first.content).toBe(second.content);
  });
});

describe("R2 runtime map generator", () => {
  function buildMap(): R2ImageMapFile {
    return exportWith({}).map;
  }

  it("emits independently disabled browser and SEO switches with a compact runtime map", () => {
    const source = buildRuntimeMapSource(buildMap(), baseAllowlist());
    expect(source).toContain("export const R2_BROWSER_IMAGES_ENABLED = true;");
    expect(source).toContain("export const R2_SEO_IMAGES_ENABLED = true;");
    expect(source).toContain('"2001-a-space-odyssey"');
    expect(source).not.toContain("stranger-things-2");
    expect(source).not.toContain("the-substance-2");
    expect(source).not.toContain("sha256");
  });

  it("rejects map entries that do not exactly match the allowlist", () => {
    const map = buildMap();
    map.entries["stranger-things-2"] = {
      ...map.entries["bugonia"],
      posterId: "stranger-things-2",
    };
    expect(() => buildRuntimeMapSource(map, baseAllowlist())).toThrow(
      /exactly match the resolver allowlist/,
    );
  });

  it("rejects an unexpected public host in the map", () => {
    const map = buildMap();
    map.publicBaseUrl = "https://evil.example.com";
    expect(() => validateR2ImageMap(map)).toThrow(/publicBaseUrl/);
  });

  it("detects stale generated output in --check mode", () => {
    const source = buildRuntimeMapSource(buildMap(), baseAllowlist());
    const outPath = path.join(tempDir, "r2-image-map.generated.ts");

    expect(checkRuntimeMap(source, outPath)).toMatchObject({ ok: false });
    fs.writeFileSync(outPath, source, "utf8");
    expect(checkRuntimeMap(source, outPath)).toMatchObject({ ok: true });

    fs.writeFileSync(outPath, `${source}\n// drift\n`, "utf8");
    expect(checkRuntimeMap(source, outPath)).toMatchObject({ ok: false });
  });

  it("generates from JSON and allowlist files", () => {
    const map = buildMap();
    const inputPath = writeJson("r2-image-map.json", map);
    const allowlistPath = writeJson("allowlist.json", baseAllowlist());
    const result = generateRuntimeMap({
      inputPath,
      allowlistPath,
      outPath: path.join(tempDir, "out.ts"),
      check: false,
    });
    expect(Object.keys(result.map.entries).sort()).toEqual([...CANARY_IDS].sort());
    expect(result.source).toContain("R2_BROWSER_IMAGES_ENABLED = true");
    expect(result.source).toContain("R2_SEO_IMAGES_ENABLED = true");
  });
});

describe("R2 resolver", () => {
  const map = R2_IMAGE_MAP;
  const browserEnabled = createPosterImageResolver(map, {
    browserEnabled: true,
    seoEnabled: false,
    downloadsEnabled: false,
  });
  const seoEnabled = createPosterImageResolver(map, {
    browserEnabled: false,
    seoEnabled: true,
    downloadsEnabled: false,
  });
  const downloadsEnabled = createPosterImageResolver(map, {
    browserEnabled: false,
    seoEnabled: false,
    downloadsEnabled: true,
  });
  const disabled = createPosterImageResolver(map, {
    browserEnabled: false,
    seoEnabled: false,
    downloadsEnabled: false,
  });

  const BLOB_2001_ORIGINAL =
    "https://csfzm0ozakaiii5u.public.blob.vercel-storage.com/cineprint/raindrop/1528361110.png";
  const BLOB_2001_OPTIMIZED =
    "https://csfzm0ozakaiii5u.public.blob.vercel-storage.com/cineprint/optimized/legacy/2001-a-space-odyssey.webp";
  const BLOB_BUGONIA =
    "https://csfzm0ozakaiii5u.public.blob.vercel-storage.com/cineprint/external/bugonia.jpg";
  const BLOB_ARTWORK_OPTIMIZED =
    "https://csfzm0ozakaiii5u.public.blob.vercel-storage.com/cineprint/optimized/1824607248.webp";

  it("activates browser and SEO delivery while keeping downloads disabled", () => {
    expect(R2_BROWSER_IMAGES_ENABLED).toBe(true);
    expect(R2_SEO_IMAGES_ENABLED).toBe(true);
    expect(ACTIVE_BROWSER_IMAGES_ENABLED).toBe(true);
    expect(ACTIVE_SEO_IMAGES_ENABLED).toBe(true);
    expect(R2_DOWNLOADS_ENABLED).toBe(false);
  });

  it("preserves Blob behavior when disabled for mapped posters", () => {
    const p = poster();
    expect(disabled.getOptimizedPosterImageUrl(p)).toBe(BLOB_2001_OPTIMIZED);
    expect(disabled.getPosterImageUrl(p, "gallery")).toBe(BLOB_2001_OPTIMIZED);
    expect(disabled.getPosterImageUrl(p, "original")).toBe(BLOB_2001_ORIGINAL);
    expect(disabled.getPosterImageUrl(p, "download")).toBe(BLOB_2001_ORIGINAL);
    expect(disabled.getPosterImageFallbackUrl(p)).toBe(BLOB_2001_ORIGINAL);
  });

  it("uses the exact R2 optimized URL for a mapped legacy poster when enabled", () => {
    const p = poster();
    expect(browserEnabled.getPosterImageUrl(p, "gallery")).toBe(
      "https://images.cineprint.click/cineprint/optimized/legacy/2001-a-space-odyssey.webp",
    );
    expect(browserEnabled.getPosterImageUrl(p, "detail")).toBe(
      "https://images.cineprint.click/cineprint/optimized/legacy/2001-a-space-odyssey.webp",
    );
    expect(browserEnabled.getOptimizedPosterImageUrl(p)).toBe(
      "https://images.cineprint.click/cineprint/optimized/legacy/2001-a-space-odyssey.webp",
    );
  });

  it("uses the exact R2 optimized URL for a mapped external poster when enabled", () => {
    const p = poster({ id: "bugonia", image: BLOB_BUGONIA });
    expect(browserEnabled.getPosterImageUrl(p, "gallery")).toBe(
      "https://images.cineprint.click/cineprint/optimized/external/bugonia.webp",
    );
    expect(browserEnabled.getOptimizedPosterImageUrl(p)).toBe(
      "https://images.cineprint.click/cineprint/optimized/external/bugonia.webp",
    );
  });

  it("uses the exact R2 optimized URL for a mapped artwork poster when enabled", () => {
    const p = poster({
      id: "artwork-1824607248",
      image:
        "https://csfzm0ozakaiii5u.public.blob.vercel-storage.com/cineprint/raindrop/1824607248.jpg",
    });
    expect(browserEnabled.getPosterImageUrl(p, "gallery")).toBe(
      "https://images.cineprint.click/cineprint/optimized/1824607248.webp",
    );
    expect(disabled.getPosterImageUrl(p, "gallery")).toBe(BLOB_ARTWORK_OPTIMIZED);
  });

  it("uses the exact R2 original for original purpose when enabled", () => {
    const p = poster();
    expect(browserEnabled.getPosterImageUrl(p, "original")).toBe(
      "https://images.cineprint.click/cineprint/raindrop/1528361110.png",
    );
  });

  it("keeps downloads on Blob when download activation is disabled", () => {
    const p = poster();
    expect(browserEnabled.getPosterImageUrl(p, "download")).toBe(BLOB_2001_ORIGINAL);
    expect(browserEnabled.getPosterDownloadUrl(p)).toBe(BLOB_2001_ORIGINAL);
    expect(browserEnabled.getPosterImageFallbackUrl(p)).toBe(BLOB_2001_ORIGINAL);
  });

  it("uses the exact R2 original for downloads when download activation is enabled", () => {
    const p = poster();
    expect(downloadsEnabled.getPosterDownloadUrl(p)).toBe(
      "https://images.cineprint.click/cineprint/raindrop/1528361110.png",
    );
    expect(downloadsEnabled.getPosterImageUrl(p, "download")).toBe(
      "https://images.cineprint.click/cineprint/raindrop/1528361110.png",
    );
    expect(downloadsEnabled.getPosterImageUrl(p, "gallery")).toBe(BLOB_2001_OPTIMIZED);
  });

  it("keeps unmapped downloads on the existing Blob URL", () => {
    const p = poster({ id: "not-mapped", image: BLOB_BUGONIA });
    expect(downloadsEnabled.getPosterDownloadUrl(p)).toBe(BLOB_BUGONIA);
  });

  it("offers R2 optimized then R2 original as finite display candidates without Blob fallback", () => {
    const p = poster();
    expect(browserEnabled.getPosterImageCandidates(p, "gallery")).toEqual([
      "https://images.cineprint.click/cineprint/optimized/legacy/2001-a-space-odyssey.webp",
      "https://images.cineprint.click/cineprint/raindrop/1528361110.png",
    ]);
    expect(browserEnabled.getPosterImageCandidates(p, "original")).toEqual([
      "https://images.cineprint.click/cineprint/raindrop/1528361110.png",
    ]);
    expect(
      browserEnabled
        .getPosterImageCandidates(p, "gallery")
        .some((url) => url.includes("public.blob.vercel-storage.com")),
    ).toBe(false);
  });

  it("preserves the existing Blob candidate sequence when browser activation is disabled", () => {
    const p = poster();
    expect(disabled.getPosterImageCandidates(p, "gallery")).toEqual([
      BLOB_2001_OPTIMIZED,
      BLOB_2001_ORIGINAL,
    ]);
  });

  it("never offers R2 candidates for unknown IDs", () => {
    const p = poster({ id: "not-mapped", image: BLOB_BUGONIA });
    expect(browserEnabled.getPosterImageCandidates(p, "gallery")).toEqual([BLOB_BUGONIA]);
  });

  it("invalidates a mapping when the Blob URL changes", () => {
    const p = poster({
      image:
        "https://csfzm0ozakaiii5u.public.blob.vercel-storage.com/cineprint/raindrop/9999999999.png",
    });
    expect(browserEnabled.getPosterImageUrl(p, "gallery")).toBe(
      "https://csfzm0ozakaiii5u.public.blob.vercel-storage.com/cineprint/optimized/legacy/2001-a-space-odyssey.webp",
    );
    expect(browserEnabled.getPosterImageUrl(p, "original")).toBe(p.image);
  });

  it("never generates R2 URLs for unknown IDs", () => {
    const p = poster({
      id: "not-mapped",
      image:
        "https://csfzm0ozakaiii5u.public.blob.vercel-storage.com/cineprint/raindrop/1779301125.png",
    });
    expect(browserEnabled.getPosterImageUrl(p, "gallery")).toContain(
      "public.blob.vercel-storage.com",
    );
    expect(browserEnabled.getPosterImageUrl(p, "gallery")).not.toContain("images.cineprint.click");
  });

  it("keeps SEO on Blob when only browser activation is enabled", () => {
    const p = poster();
    expect(browserEnabled.getPosterImageUrl(p, "gallery")).toBe(
      "https://images.cineprint.click/cineprint/optimized/legacy/2001-a-space-odyssey.webp",
    );
    expect(browserEnabled.getPosterSeoImageUrl(p)).toBe(BLOB_2001_OPTIMIZED);
  });

  it("keeps browser on Blob when only SEO activation is enabled", () => {
    const p = poster();
    expect(seoEnabled.getPosterSeoImageUrl(p)).toBe(
      "https://images.cineprint.click/cineprint/optimized/legacy/2001-a-space-odyssey.webp",
    );
    expect(seoEnabled.getPosterImageUrl(p, "gallery")).toBe(BLOB_2001_OPTIMIZED);
    expect(seoEnabled.getPosterImageUrl(p, "detail")).toBe(BLOB_2001_OPTIMIZED);
    expect(seoEnabled.getPosterImageUrl(p, "original")).toBe(BLOB_2001_ORIGINAL);
    expect(seoEnabled.getPosterImageUrl(p, "download")).toBe(BLOB_2001_ORIGINAL);
  });

  it("keeps SEO on Blob when both activation switches are disabled", () => {
    const p = poster();
    expect(disabled.getPosterSeoImageUrl(p)).toBe(BLOB_2001_OPTIMIZED);
  });

  it("uses R2 for OG, JSON-LD and sitemap only when SEO activation is enabled", () => {
    const p = poster();
    const r2 =
      "https://images.cineprint.click/cineprint/optimized/legacy/2001-a-space-odyssey.webp";

    const enabledHead = posterHeadMeta(p, seoEnabled.getPosterSeoImageUrl);
    expect(enabledHead.meta.find((tag) => tag.property === "og:image")?.content).toBe(r2);

    const enabledJsonLd = JSON.stringify(
      posterPageEntities(p, null, seoEnabled.getPosterSeoImageUrl),
    );
    expect(enabledJsonLd).toContain(r2);

    const enabledSitemap = posterUrlEntries(
      [{ id: p.id, data: { image: p.image, status: "published" } }],
      seoEnabled.getPosterSeoImageUrl,
    );
    expect(enabledSitemap[0].image).toBe(r2);

    const artistHead = artistHeadMeta([p], "artist", seoEnabled.getPosterSeoImageUrl);
    expect(artistHead.meta.find((tag) => tag.property === "og:image")?.content).toBe(r2);

    const disabledHead = posterHeadMeta(p, disabled.getPosterSeoImageUrl);
    expect(disabledHead.meta.find((tag) => tag.property === "og:image")?.content).toBe(
      BLOB_2001_OPTIMIZED,
    );
  });

  it("invalidates SEO mappings when the Blob URL changes", () => {
    const p = poster({
      image:
        "https://csfzm0ozakaiii5u.public.blob.vercel-storage.com/cineprint/raindrop/9999999999.png",
    });
    expect(seoEnabled.getPosterSeoImageUrl(p)).toBe(
      "https://csfzm0ozakaiii5u.public.blob.vercel-storage.com/cineprint/optimized/legacy/2001-a-space-odyssey.webp",
    );
  });

  it("never generates SEO R2 URLs for unknown IDs", () => {
    const p = poster({
      id: "not-mapped",
      image:
        "https://csfzm0ozakaiii5u.public.blob.vercel-storage.com/cineprint/raindrop/1779301125.png",
    });
    expect(seoEnabled.getPosterSeoImageUrl(p)).toContain("public.blob.vercel-storage.com");
    expect(seoEnabled.getPosterSeoImageUrl(p)).not.toContain("images.cineprint.click");
  });

  it("has no medium-confidence mappings", () => {
    for (const id of MEDIUM_IDS) {
      expect(map[id]).toBeUndefined();
    }
  });
});
