import { describe, expect, it } from "vitest";
import type { Poster } from "../src/lib/posters";
import { createPosterImageResolver, POSTER_UNAVAILABLE_URL } from "../src/lib/poster-images";
import { toPlainPoster } from "../src/lib/notion";
import { validateR2ImageReference } from "../src/lib/r2-image-reference";
import type { R2ImageReference } from "../src/lib/r2-image-reference";
import type { R2ImageMapEntry } from "../src/lib/r2-image-map.generated";

const SOURCE_SHA = "a".repeat(64);
const POSTER_ID = "artwork-9001";

function dynamicRef(overrides: Partial<R2ImageReference> = {}): R2ImageReference {
  return {
    sourceSha256: SOURCE_SHA,
    original: {
      key: `cineprint/versions/original/${POSTER_ID}/${SOURCE_SHA}.png`,
      url: `https://images.cineprint.click/cineprint/versions/original/${POSTER_ID}/${SOURCE_SHA}.png`,
      sha256: SOURCE_SHA,
      sizeBytes: 1000,
      contentType: "image/png",
    },
    optimized: {
      key: `cineprint/versions/optimized/${POSTER_ID}/${SOURCE_SHA}-sharp-0.35.3-libvips-8.18.3-w800-q80.webp`,
      url: `https://images.cineprint.click/cineprint/versions/optimized/${POSTER_ID}/${SOURCE_SHA}-sharp-0.35.3-libvips-8.18.3-w800-q80.webp`,
      sha256: "b".repeat(64),
      sizeBytes: 400,
      contentType: "image/webp",
    },
    verifiedAt: "2026-11-10T00:00:00.000Z",
    ...overrides,
  };
}

function poster(overrides: Partial<Poster> = {}): Poster {
  const ref = dynamicRef();
  return {
    id: POSTER_ID,
    title: "A New Poster",
    year: 2026,
    artist: "Someone",
    source: "Raindrop",
    sourceUrl: "https://example.com",
    image: ref.original.url,
    style: "Minimalist",
    genre: ["Drama"],
    tags: [],
    r2Image: ref,
    ...overrides,
  };
}

function resolver(map: Record<string, R2ImageMapEntry> = {}) {
  return createPosterImageResolver(map, {
    browserEnabled: true,
    seoEnabled: true,
    downloadsEnabled: true,
  });
}

describe("dynamic R2 poster images", () => {
  it("serves optimized and original URLs from the poster document", () => {
    const subject = resolver();
    const entry = poster().r2Image!;

    expect(subject.getPosterImageUrl(poster())).toBe(entry.optimized.url);
    expect(subject.getPosterImageUrl(poster(), "original")).toBe(entry.original.url);
    expect(subject.getPosterImageCandidates(poster())).toEqual([
      entry.optimized.url,
      entry.original.url,
    ]);
    expect(subject.getPosterSeoImageUrl(poster())).toBe(entry.optimized.url);
    expect(subject.getPosterDownloadUrl(poster())).toBe(entry.original.url);
  });

  it("does not fall back to Blob for a dynamic poster", () => {
    const subject = resolver();
    const blobPoster = poster({
      image: "https://csfzm0ozakaiii5u.public.blob.vercel-storage.com/cineprint/raindrop/9001.png",
    });
    expect(subject.getPosterImageCandidates(blobPoster)).toEqual([
      blobPoster.r2Image!.optimized.url,
      blobPoster.r2Image!.original.url,
    ]);
  });

  it("fails closed when the dynamic reference is malformed", () => {
    const subject = resolver();
    const broken = poster({
      r2Image: dynamicRef({
        original: {
          ...dynamicRef().original,
          url: "https://evil.example.com/a.png",
        },
      }),
    });

    expect(subject.getPosterImageCandidates(broken)).toEqual([]);
    expect(subject.getPosterImageUrl(broken)).toBe(POSTER_UNAVAILABLE_URL);
    expect(subject.getPosterSeoImageUrl(broken)).toContain("poster-unavailable.svg");
    expect(subject.getPosterDownloadUrl(broken)).toBe("");
  });

  it("rejects a reference that belongs to another poster", () => {
    const subject = resolver();
    const other = poster({ id: "artwork-111" });
    expect(subject.getPosterImageCandidates(other)).toEqual([]);
  });

  it("ignores the dynamic reference when browser delivery is disabled", () => {
    const subject = createPosterImageResolver(
      {},
      { browserEnabled: false, seoEnabled: true, downloadsEnabled: false },
    );
    expect(subject.getPosterImageUrl(poster())).toBe(poster().image);
  });

  it("keeps the generated map authoritative for existing posters", () => {
    const staticEntry: R2ImageMapEntry = {
      blobImageUrl:
        "https://csfzm0ozakaiii5u.public.blob.vercel-storage.com/cineprint/raindrop/9001.png",
      originalUrl: "https://images.cineprint.click/cineprint/versions/original/legacy/a.png",
      optimizedUrl: "https://images.cineprint.click/cineprint/versions/optimized/legacy/a.webp",
      originalKey: "cineprint/versions/original/legacy/a.png",
      optimizedKey: "cineprint/versions/optimized/legacy/a.webp",
      verifiedAt: "2026-11-08T00:00:00.000Z",
    };
    const subject = resolver({ [POSTER_ID]: staticEntry });
    const existing = poster({ image: staticEntry.blobImageUrl, r2Image: dynamicRef() });

    expect(subject.getPosterImageUrl(existing)).toBe(staticEntry.optimizedUrl);
  });

  it("preserves the intentionally unavailable placeholders", () => {
    const subject = resolver();
    const unavailable = poster({ id: "stranger-things-2" });
    expect(subject.getPosterImageUrl(unavailable)).toBe(POSTER_UNAVAILABLE_URL);
    expect(subject.getPosterImageCandidates(unavailable)).toEqual([]);
    expect(subject.getPosterDownloadUrl(unavailable)).toBe("");
  });

  it("keeps the legacy Blob fallback for unmapped posters", () => {
    const subject = resolver();
    const legacy = poster({
      id: "legacy-poster",
      r2Image: undefined,
      image: "https://csfzm0ozakaiii5u.public.blob.vercel-storage.com/cineprint/raindrop/1234.png",
    });

    expect(subject.getPosterImageUrl(legacy)).toBe(
      "https://csfzm0ozakaiii5u.public.blob.vercel-storage.com/cineprint/optimized/legacy/legacy-poster.webp",
    );
  });
});

describe("dynamic R2 reference validation", () => {
  const valid = () => dynamicRef();

  it("rejects a malformed object", () => {
    expect(validateR2ImageReference({}, POSTER_ID)).toMatchObject({ ok: false });
  });

  it("rejects a wrong hostname", () => {
    const ref = valid();
    ref.original.url = "https://evil.example/cineprint/versions/original/artwork-9001/a.png";
    expect(validateR2ImageReference(ref, POSTER_ID)).toMatchObject({ ok: false });
  });

  it("rejects a reference that belongs to another poster identity", () => {
    expect(validateR2ImageReference(valid(), "artwork-111")).toMatchObject({ ok: false });
  });

  it("rejects an invalid hash, size or content type", () => {
    const badHash = valid();
    badHash.original.sha256 = "z".repeat(64);
    expect(validateR2ImageReference(badHash, POSTER_ID)).toMatchObject({ ok: false });

    const badSize = valid();
    badSize.optimized.sizeBytes = 0;
    expect(validateR2ImageReference(badSize, POSTER_ID)).toMatchObject({ ok: false });

    const badType = valid();
    badType.optimized.contentType = "image/png";
    expect(validateR2ImageReference(badType, POSTER_ID)).toMatchObject({ ok: false });
  });

  it("rejects a URL that does not match its key", () => {
    const ref = valid();
    ref.optimized.url = ref.original.url;
    expect(validateR2ImageReference(ref, POSTER_ID)).toMatchObject({ ok: false });
  });
});

describe("Firestore poster parsing preserves invalid dynamic state", () => {
  it("keeps a valid dynamic reference", () => {
    const poster = toPlainPoster(POSTER_ID, {
      title: "A Poster",
      year: 2026,
      image: dynamicRef().original.url,
      r2Image: dynamicRef(),
    });

    expect(poster.r2Image).toBeDefined();
    expect(poster.r2ImageInvalid).toBeUndefined();
  });

  it("marks a malformed supplied reference instead of dropping it", () => {
    const poster = toPlainPoster(POSTER_ID, {
      title: "A Poster",
      year: 2026,
      image: "https://csfzm0ozakaiii5u.public.blob.vercel-storage.com/cineprint/raindrop/9001.png",
      r2Image: { nonsense: true },
    });

    expect(poster.r2Image).toBeUndefined();
    expect(poster.r2ImageInvalid).toBe(true);
  });

  it("marks a wrong-identity reference", () => {
    const ref = dynamicRef();
    ref.original.key = "cineprint/versions/original/artwork-111/" + SOURCE_SHA + ".png";
    ref.original.url = "https://images.cineprint.click/" + ref.original.key;
    const poster = toPlainPoster(POSTER_ID, {
      title: "A Poster",
      year: 2026,
      image: ref.original.url,
      r2Image: ref,
    });

    expect(poster.r2ImageInvalid).toBe(true);
  });

  it("leaves an absent reference unchanged for legacy records", () => {
    const poster = toPlainPoster("legacy-poster", {
      title: "Legacy",
      year: 2020,
      image: "https://csfzm0ozakaiii5u.public.blob.vercel-storage.com/cineprint/raindrop/1.png",
    });

    expect(poster.r2Image).toBeUndefined();
    expect(poster.r2ImageInvalid).toBeUndefined();
  });

  it("fails closed for an invalid supplied reference instead of using Blob or raw image", () => {
    const blobImage =
      "https://csfzm0ozakaiii5u.public.blob.vercel-storage.com/cineprint/raindrop/9001.png";
    const poster = toPlainPoster(POSTER_ID, {
      title: "A Poster",
      year: 2026,
      image: blobImage,
      r2Image: { original: { url: "https://evil.example/a.png" } },
    });
    const subject = createPosterImageResolver(
      {},
      { browserEnabled: true, seoEnabled: true, downloadsEnabled: true },
    );

    expect(poster.r2ImageInvalid).toBe(true);
    expect(subject.getPosterImageCandidates(poster)).toEqual([]);
    expect(subject.getPosterImageUrl(poster)).toBe(POSTER_UNAVAILABLE_URL);
    expect(subject.getPosterSeoImageUrl(poster)).toContain("poster-unavailable.svg");
    expect(subject.getPosterDownloadUrl(poster)).toBe("");
    expect(subject.getPosterImageFallbackUrl(poster)).toBe(POSTER_UNAVAILABLE_URL);
  });
});
