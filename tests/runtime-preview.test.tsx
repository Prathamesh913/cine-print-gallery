import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { R2_IMAGE_MAP } from "../src/lib/r2-image-map.generated";
import {
  R2_BROWSER_IMAGES_ENABLED,
  R2_DOWNLOADS_ENABLED,
  R2_SEO_IMAGES_ENABLED,
} from "../src/lib/r2-image-activation";
import {
  POSTER_UNAVAILABLE_ABSOLUTE_URL,
  POSTER_UNAVAILABLE_URL,
  createPosterImageResolver,
} from "../src/lib/poster-images";
import { isPosterImageUnavailable } from "../src/lib/poster-availability";
import { PosterImage } from "../src/components/PosterImage";
import type { Poster } from "../src/lib/posters";

const CANARIES = new Set(["2001-a-space-odyssey", "bugonia", "artwork-1824607248"]);
const ALLOWLIST = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "migration", "r2-resolver-allowlist.json"), "utf8"),
) as { schemaVersion: number; posters: string[] };

const previewResolver = createPosterImageResolver(R2_IMAGE_MAP, {
  browserEnabled: true,
  seoEnabled: false,
  downloadsEnabled: false,
});

function unavailablePoster(id: string): Poster {
  return {
    id,
    title: id,
    year: 0,
    artist: "",
    source: "",
    sourceUrl: "",
    image: `https://csfzm0ozakaiii5u.public.blob.vercel-storage.com/cineprint/external/${id}.jpg`,
    style: "Minimalist",
    genre: [],
    tags: [],
  };
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

describe("F28 — browser runtime preview inventory", () => {
  it("covers exactly 61 identities with matching allowlist coverage", () => {
    const ids = Object.keys(R2_IMAGE_MAP).sort();
    expect(ids).toHaveLength(61);
    expect(ALLOWLIST.posters).toHaveLength(61);
    expect(ids).toEqual([...ALLOWLIST.posters].sort());
    expect(new Set(ids).size).toBe(61);
  });

  it("resolves every migrated identity to its optimized and original R2 URLs", () => {
    for (const [id, entry] of Object.entries(R2_IMAGE_MAP)) {
      const poster = posterFor(id);
      expect(previewResolver.getPosterImageUrl(poster, "gallery")).toBe(entry.optimizedUrl);
      expect(previewResolver.getPosterImageUrl(poster, "original")).toBe(entry.originalUrl);
      expect(previewResolver.getPosterImageCandidates(poster, "gallery")[0]).toBe(
        entry.optimizedUrl,
      );
      expect(entry.optimizedUrl).toBe(`https://images.cineprint.click/${entry.optimizedKey}`);
      expect(entry.originalUrl).toBe(`https://images.cineprint.click/${entry.originalKey}`);
      expect(entry.optimizedKey.endsWith(".webp")).toBe(true);
    }
  });

  it("preserves canary behavior", () => {
    for (const id of CANARIES) {
      const entry = R2_IMAGE_MAP[id];
      const poster = posterFor(id);
      expect(previewResolver.getPosterImageUrl(poster, "gallery")).toBe(entry.optimizedUrl);
      expect(previewResolver.getPosterImageUrl(poster, "original")).toBe(entry.originalUrl);
    }
  });

  it("does not construct R2 URLs for unknown identities", () => {
    const poster = posterFor("bugonia");
    const unknown = { ...poster, id: "unknown-poster" };
    expect(previewResolver.getPosterImageUrl(unknown, "gallery")).not.toMatch(
      /^https:\/\/images\.cineprint\.click\/cineprint\/versions\//,
    );
    expect(previewResolver.getPosterImageCandidates(unknown, "gallery")[0]).not.toMatch(
      /^https:\/\/images\.cineprint\.click\/cineprint\/versions\//,
    );
  });

  it("does not reuse a mapping when the poster image URL changes", () => {
    const poster = posterFor("bugonia");
    const changed = {
      ...poster,
      image:
        "https://csfzm0ozakaiii5u.public.blob.vercel-storage.com/cineprint/external/bugonia-v2.jpg",
    };
    expect(previewResolver.getPosterImageUrl(changed, "gallery")).toBe(changed.image);
    expect(previewResolver.getPosterImageCandidates(changed, "gallery")).toEqual([changed.image]);
  });

  it("falls back safely when a mapping is absent", () => {
    const map = Object.fromEntries(Object.entries(R2_IMAGE_MAP).filter(([id]) => id !== "bugonia"));
    const resolver = createPosterImageResolver(map, {
      browserEnabled: true,
      seoEnabled: false,
      downloadsEnabled: false,
    });
    const poster = posterFor("bugonia");
    expect(resolver.getPosterImageUrl(poster, "gallery")).not.toMatch(
      /^https:\/\/images\.cineprint\.click\/cineprint\/versions\//,
    );
  });

  it("keeps SEO and downloads isolated from browser preview", () => {
    const poster = posterFor("bugonia");
    expect(previewResolver.getPosterSeoImageUrl(poster)).not.toMatch(
      /^https:\/\/images\.cineprint\.click\/cineprint\/versions\//,
    );
    expect(previewResolver.getPosterDownloadUrl(poster)).not.toMatch(
      /^https:\/\/images\.cineprint\.click\/cineprint\/versions\//,
    );
    expect(R2_BROWSER_IMAGES_ENABLED).toBe(true);
    expect(R2_SEO_IMAGES_ENABLED).toBe(true);
    expect(R2_DOWNLOADS_ENABLED).toBe(false);
  });

  it("renders the real PosterImage with the optimized URL and alt text", () => {
    const id = "bugonia";
    const poster = posterFor(id);
    const html = renderToStaticMarkup(
      React.createElement(PosterImage, {
        poster,
        resolver: previewResolver,
        alt: `Poster ${id}`,
        loading: "lazy",
      }),
    );
    expect(html).toContain(R2_IMAGE_MAP[id].optimizedUrl);
    expect(html).toContain(`alt="Poster ${id}"`);
    expect(html).toContain('loading="lazy"');
  });

  it("fails closed for mappings with a missing or malformed optimized URL", () => {
    const id = "bugonia";
    const poster = posterFor(id);
    for (const optimizedUrl of ["", "not-a-url", "https://example.com/x.webp"]) {
      const map = {
        ...R2_IMAGE_MAP,
        [id]: { ...R2_IMAGE_MAP[id], optimizedUrl },
      };
      const resolver = createPosterImageResolver(map, {
        browserEnabled: true,
        seoEnabled: false,
        downloadsEnabled: false,
      });
      expect(resolver.getPosterImageCandidates(poster, "gallery")).toEqual([]);
      expect(resolver.getPosterImageUrl(poster, "gallery")).not.toMatch(
        /^https:\/\/images\.cineprint\.click\//,
      );
    }
  });

  it("fails closed for mappings with a missing or malformed original URL", () => {
    const id = "bugonia";
    const poster = posterFor(id);
    for (const originalUrl of ["", "not-a-url", "http://images.cineprint.click/x.png"]) {
      const map = {
        ...R2_IMAGE_MAP,
        [id]: { ...R2_IMAGE_MAP[id], originalUrl },
      };
      const resolver = createPosterImageResolver(map, {
        browserEnabled: true,
        seoEnabled: false,
        downloadsEnabled: false,
      });
      expect(resolver.getPosterImageCandidates(poster, "gallery")).toEqual([]);
      expect(resolver.getPosterImageCandidates(poster, "original")).toEqual([]);
      expect(resolver.getPosterImageUrl(poster, "original")).toBe(poster.image);
    }
  });

  it("renders the neutral unavailable asset for a malformed mapped entry", () => {
    const id = "bugonia";
    const poster = posterFor(id);
    const map = {
      ...R2_IMAGE_MAP,
      [id]: { ...R2_IMAGE_MAP[id], optimizedUrl: "not-a-url" },
    };
    const resolver = createPosterImageResolver(map, {
      browserEnabled: true,
      seoEnabled: false,
      downloadsEnabled: false,
    });
    const html = renderToStaticMarkup(
      React.createElement(PosterImage, {
        poster,
        resolver,
        alt: "Poster",
      }),
    );
    expect(html).toContain(POSTER_UNAVAILABLE_URL);
    expect(html).toContain('data-poster-unavailable-id="bugonia"');
    expect(html).not.toContain("public.blob.vercel-storage.com");
  });

  it("does not reuse a mapping for a different blob identity", () => {
    const id = "bugonia";
    const poster = posterFor(id);
    const map = {
      ...R2_IMAGE_MAP,
      [id]: { ...R2_IMAGE_MAP[id], blobImageUrl: "https://example.com/other.jpg" },
    };
    const resolver = createPosterImageResolver(map, {
      browserEnabled: true,
      seoEnabled: false,
      downloadsEnabled: false,
    });
    expect(resolver.getPosterImageUrl(poster, "gallery")).toBe(poster.image);
  });

  it("marks exactly the two unresolved identities as intentionally unavailable", () => {
    expect(isPosterImageUnavailable("stranger-things-2")).toBe(true);
    expect(isPosterImageUnavailable("the-substance-2")).toBe(true);
    expect(isPosterImageUnavailable("bugonia")).toBe(false);
    expect(isPosterImageUnavailable("2001-a-space-odyssey")).toBe(false);
  });

  it("renders an accessible local unavailable asset instead of Blob or a broken image", () => {
    for (const id of ["stranger-things-2", "the-substance-2"]) {
      const poster = unavailablePoster(id);
      expect(previewResolver.getPosterImageCandidates(poster, "gallery")).toEqual([]);
      expect(previewResolver.getPosterImageUrl(poster, "gallery")).toBe(POSTER_UNAVAILABLE_URL);
      expect(previewResolver.getPosterSeoImageUrl(poster)).toBe(POSTER_UNAVAILABLE_ABSOLUTE_URL);
      expect(previewResolver.getPosterDownloadUrl(poster)).toBe("");

      const html = renderToStaticMarkup(
        React.createElement(PosterImage, {
          poster,
          resolver: previewResolver,
          alt: `${poster.title} poster`,
        }),
      );
      expect(html).toContain(POSTER_UNAVAILABLE_URL);
      expect(html).toContain(`data-poster-unavailable-id="${id}"`);
      expect(html).toContain('alt="Image unavailable: ');
      expect(html).not.toContain("public.blob.vercel-storage.com");
    }
  });

  it("does not expose private migration metadata in the runtime map", () => {
    const serialized = JSON.stringify(R2_IMAGE_MAP);
    expect(serialized).not.toContain("sourceImageUrl");
    expect(serialized).not.toContain("localPath");
    expect(serialized).not.toContain("migration/cache");
    expect(serialized).not.toContain("api.raindrop.io");
    expect(serialized).not.toContain("pbs.twimg.com");
    expect(serialized).not.toContain("Authorization");
  });
});
