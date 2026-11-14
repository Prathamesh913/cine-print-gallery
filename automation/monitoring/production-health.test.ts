import { describe, expect, it } from "vitest";
import {
  evaluateProductionHealth,
  parseInlinedEnvKeys,
  resolveCatalogueImage,
  type CataloguePoster,
  type HarnessResult,
  type PublicImageCheck,
  type StaticImageMap,
} from "./production-health";

const POSTER_COUNT = 64;
const REPAIRED_IDS = ["the-substance-2", "stranger-things-2"] as const;

function posterId(index: number): string {
  return index < REPAIRED_IDS.length ? REPAIRED_IDS[index] : `poster-${index}`;
}

function sha(index: number): string {
  return (index + 1).toString(16).padStart(64, "0");
}

function blobUrl(index: number): string {
  return `https://csfzm0ozakaiii5u.public.blob.vercel-storage.com/cineprint/raindrop/${1500000000 + index}.png`;
}

function reference(index: number) {
  const id = posterId(index);
  const sourceSha = sha(index);
  return {
    sourceSha256: sourceSha,
    original: {
      key: `cineprint/versions/original/${id}/${sourceSha}.jpg`,
      url: `https://images.cineprint.click/cineprint/versions/original/${id}/${sourceSha}.jpg`,
      sha256: sourceSha,
      sizeBytes: 1000 + index,
      contentType: "image/jpeg",
    },
    optimized: {
      key: `cineprint/versions/optimized/${id}/${sourceSha}-sharp-0.35.3-libvips-8.18.3-w800-q80.webp`,
      url: `https://images.cineprint.click/cineprint/versions/optimized/${id}/${sourceSha}-sharp-0.35.3-libvips-8.18.3-w800-q80.webp`,
      sha256: "b".repeat(64),
      sizeBytes: 500 + index,
      contentType: "image/webp",
    },
    verifiedAt: "2026-11-14T00:00:00.000Z",
  };
}

/** One static-map entry shaped like `src/lib/r2-image-map.generated.ts`. */
function mapEntry(index: number) {
  const referenceValue = reference(index);
  return {
    blobImageUrl: blobUrl(index),
    originalUrl: referenceValue.original.url,
    optimizedUrl: referenceValue.optimized.url,
    originalKey: referenceValue.original.key,
    optimizedKey: referenceValue.optimized.key,
    verifiedAt: referenceValue.verifiedAt,
  };
}

function catalogue(): CataloguePoster[] {
  return Array.from({ length: POSTER_COUNT }, (_, index) => ({
    id: posterId(index),
    image: blobUrl(index),
    r2Image: reference(index),
  }));
}

function publicImages(): PublicImageCheck[] {
  return catalogue().map((poster, index) => ({
    posterId: poster.id,
    url: reference(index).optimized.url,
    ok: true,
    status: 200,
    contentType: "image/webp",
    contentLength: 500 + index,
  }));
}

function routeData(overrides: Record<string, unknown> = {}) {
  return {
    page: {
      path: "/",
      posterLinks: Array.from({ length: POSTER_COUNT }, (_, index) => `/poster/${posterId(index)}`),
      r2Count: 10,
      blobCount: 0,
      brokenCount: 0,
      unavailableIds: [],
      ...overrides,
    },
    network: {
      rows: [{ url: "https://images.cineprint.click/a.webp", status: 200, failed: false }],
      failed: [],
      otherHosts: ["cineprint.click"],
      blobRequests: 0,
    },
    console: { consoleEvents: [], exceptions: [] },
  };
}

function healthyHarness(): HarnessResult {
  const routes: Record<string, unknown> = {};
  for (const viewport of ["desktop", "mobile"]) {
    routes[`home-${viewport}`] = routeData();
    routes[`detail-${viewport}`] = routeData({ posterLinks: [] });
    routes[`category-${viewport}`] = routeData({ posterLinks: [] });
    for (const id of REPAIRED_IDS) {
      routes[`repaired-detail-${id}-${viewport}`] = routeData({
        path: `/poster/${id}`,
        posterLinks: [],
        r2Count: 1,
      });
    }
  }
  return { summary: { checks: 42, passed: 42, failed: 0 }, routes };
}

function sitemapXml(mode: "r2" | "blob" = "r2"): string {
  return `<urlset>${catalogue()
    .map((_poster, index) => {
      const image =
        mode === "r2"
          ? reference(index).optimized.url
          : `https://csfzm0ozakaiii5u.public.blob.vercel-storage.com/cineprint/optimized/legacy/${posterId(index)}.webp`;
      return `<url><loc>https://cineprint.click/poster/${posterId(index)}</loc><image:loc>${image}</image:loc></url>`;
    })
    .join("")}</urlset>`;
}

const healthyInput = () => ({
  harness: healthyHarness(),
  assetSource:
    "const x = H?.VITE_R2_DOWNLOADS; const y = H?.VITE_VERCEL_ENV; const z = `/poster-unavailable.svg`;",
  mappedDetailHtml:
    '<meta property="og:image" content="https://images.cineprint.click/cineprint/optimized/legacy/backrooms-3.webp">',
  catalogue: catalogue(),
  staticMap: {} as StaticImageMap,
  publicImages: publicImages(),
  sitemapXml: sitemapXml(),
});

describe("catalogue image resolution", () => {
  it("resolves repaired posters through their dynamic r2Image reference", () => {
    for (const id of REPAIRED_IDS) {
      const row = catalogue().find((poster) => poster.id === id)!;
      const resolution = resolveCatalogueImage(row, {});
      expect(resolution.optimizedUrl).toBe(
        (row.r2Image as ReturnType<typeof reference>).optimized.url,
      );
      expect(resolution.invalidReference).toBe(false);
      expect(resolution.unavailable).toBe(false);
    }
  });

  it("resolves existing posters through their trusted static-map entry", () => {
    const row = { id: "poster-7", image: blobUrl(7) };
    const resolution = resolveCatalogueImage(row, { "poster-7": mapEntry(7) });
    expect(resolution.optimizedUrl).toBe(reference(7).optimized.url);
    expect(resolution.unavailable).toBe(false);
  });

  it("ignores a static-map entry whose Blob identity no longer matches", () => {
    const row = { id: "poster-7", image: "https://example.com/other.png" };
    const resolution = resolveCatalogueImage(row, { "poster-7": mapEntry(7) });
    expect(resolution.optimizedUrl).toBeNull();
    expect(resolution.unavailable).toBe(false);
  });

  it("keeps an unavailable identity on the placeholder without a valid reference", () => {
    const row = { id: "stranger-things-2", image: blobUrl(1) };
    const resolution = resolveCatalogueImage(row, {});
    expect(resolution.optimizedUrl).toBeNull();
    expect(resolution.unavailable).toBe(true);
    expect(resolution.seoUrl).toBe("https://cineprint.click/poster-unavailable.svg");
  });

  it("fails a supplied but invalid r2Image closed to the placeholder", () => {
    const row = { id: "poster-8", image: blobUrl(8), r2Image: { nonsense: true } };
    const resolution = resolveCatalogueImage(row, {});
    expect(resolution.optimizedUrl).toBeNull();
    expect(resolution.invalidReference).toBe(true);
    expect(resolution.unavailable).toBe(true);
  });
});

describe("production health evaluation", () => {
  it("passes a catalogue-driven healthy snapshot", () => {
    const result = evaluateProductionHealth(healthyInput());
    expect(result.failed).toBe(0);
    expect(result.checks.length).toBeGreaterThan(20);
    expect(
      result.checks.find(
        (check) => check.name === "every published poster resolves to an R2 optimized image",
      )?.detail,
    ).toMatchObject({ r2Backed: POSTER_COUNT, published: POSTER_COUNT });
  });

  it("fails with the affected poster ID when an r2Image is invalid", () => {
    const input = healthyInput();
    input.catalogue[0] = { id: "the-substance-2", image: blobUrl(0), r2Image: { nonsense: true } };
    const result = evaluateProductionHealth(input);
    expect(
      result.checks.find(
        (check) => check.name === "no published poster has an invalid r2Image reference",
      ),
    ).toMatchObject({ status: "FAIL", detail: { invalidIds: ["the-substance-2"] } });
    expect(
      result.checks.find(
        (check) => check.name === "no published poster renders the unavailable placeholder",
      ),
    ).toMatchObject({ status: "FAIL", detail: { placeholderIds: ["the-substance-2"] } });
  });

  it("fails with the affected poster ID when public delivery fails", () => {
    const input = healthyInput();
    input.publicImages[0] = {
      posterId: "the-substance-2",
      url: reference(0).optimized.url,
      ok: false,
      status: 404,
      contentType: "text/html",
      reason: "not found",
    };
    const result = evaluateProductionHealth(input);
    expect(
      result.checks.find((check) => check.name === "all published posters have public R2 delivery"),
    ).toMatchObject({ status: "FAIL", detail: { failedIds: ["the-substance-2"] } });
  });

  it("fails with the affected poster ID when the sitemap URL differs", () => {
    const input = healthyInput();
    input.sitemapXml = sitemapXml().replace(
      reference(0).optimized.url,
      "https://images.cineprint.click/wrong.webp",
    );
    const result = evaluateProductionHealth(input);
    expect(
      result.checks.find((check) => check.name === "sitemap uses each poster's R2 optimized URL"),
    ).toMatchObject({ status: "FAIL", detail: { mismatchedIds: ["the-substance-2"] } });
  });

  it("fails when an intentional placeholder is present", () => {
    const input = healthyInput();
    (input.harness.routes!["home-desktop"] as ReturnType<typeof routeData>).page.unavailableIds = [
      "the-substance-2",
    ];
    const result = evaluateProductionHealth(input);
    expect(
      result.checks.find((check) => check.name === "home desktop: zero intentional placeholders"),
    ).toMatchObject({ status: "FAIL", detail: { unavailableIds: ["the-substance-2"] } });
  });

  it("fails when a repaired detail route still renders a placeholder", () => {
    const input = healthyInput();
    (
      input.harness.routes!["repaired-detail-the-substance-2-desktop"] as ReturnType<
        typeof routeData
      >
    ).page.unavailableIds = ["the-substance-2"];
    const result = evaluateProductionHealth(input);
    expect(
      result.checks.find(
        (check) => check.name === "repaired detail the-substance-2 desktop: R2 image rendered",
      )?.status,
    ).toBe("FAIL");
  });

  it("reports an unavailable poster that has no valid reference", () => {
    const input = healthyInput();
    input.catalogue[1] = { id: "stranger-things-2", image: blobUrl(1) };
    input.publicImages = input.publicImages.filter(
      (entry) => entry.posterId !== "stranger-things-2",
    );
    const result = evaluateProductionHealth(input);
    expect(result.failed).toBeGreaterThan(0);
    expect(
      result.checks.find(
        (check) => check.name === "every published poster resolves to an R2 optimized image",
      ),
    ).toMatchObject({ status: "FAIL", detail: { failedIds: ["stranger-things-2"] } });
    expect(
      result.checks.find(
        (check) => check.name === "no published poster renders the unavailable placeholder",
      ),
    ).toMatchObject({ status: "FAIL", detail: { placeholderIds: ["stranger-things-2"] } });
  });

  it("ignores favicon duplicates but still catches poster duplicates", () => {
    const healthy = healthyInput();
    (healthy.harness.routes!["home-desktop"] as ReturnType<typeof routeData>).network.rows = [
      { url: "https://cineprint.click/apple-touch-icon.png", status: 200, failed: false },
      { url: "https://cineprint.click/apple-touch-icon.png", status: 200, failed: false },
      { url: "https://images.cineprint.click/poster.webp", status: 200, failed: false },
    ];
    expect(evaluateProductionHealth(healthy).failed).toBe(0);

    const duplicatePoster = healthyInput();
    (duplicatePoster.harness.routes!["home-desktop"] as ReturnType<typeof routeData>).network.rows =
      [
        { url: "https://images.cineprint.click/poster.webp", status: 200, failed: false },
        { url: "https://images.cineprint.click/poster.webp", status: 200, failed: false },
      ];
    expect(
      evaluateProductionHealth(duplicatePoster).checks.find((check) =>
        check.name.includes("no duplicate image requests"),
      )?.status,
    ).toBe("FAIL");
  });

  it("fails when a Blob image appears", () => {
    const input = healthyInput();
    (input.harness.routes!["home-desktop"] as ReturnType<typeof routeData>).page.blobCount = 1;
    const result = evaluateProductionHealth(input);
    expect(result.failed).toBeGreaterThan(0);
    expect(
      result.checks.find((check) => check.name === "home desktop: no Blob images")?.status,
    ).toBe("FAIL");
  });

  it("supports the legacy Blob SEO expectation", () => {
    const input = healthyInput();
    input.expectedSeo = "blob";
    input.mappedDetailHtml =
      '<meta property="og:image" content="https://csfzm0ozakaiii5u.public.blob.vercel-storage.com/cineprint/optimized/legacy/backrooms-3.webp">';
    input.sitemapXml = sitemapXml("blob");
    const result = evaluateProductionHealth(input);
    expect(result.failed).toBe(0);
    expect(
      result.checks.find((check) => check.name === "mapped detail SEO remains off R2")?.status,
    ).toBe("PASS");
  });

  it("fails when mapped-detail SEO uses R2 while Blob is expected", () => {
    const input = healthyInput();
    input.expectedSeo = "blob";
    const result = evaluateProductionHealth(input);
    expect(
      result.checks.find((check) => check.name === "mapped detail SEO remains off R2")?.status,
    ).toBe("FAIL");
  });

  it("ignores env property reads and captures inlined env keys", () => {
    expect(
      parseInlinedEnvKeys(
        "VITE_FIREBASE_PROJECT_ID:`cineprint`,H?.VITE_R2_DOWNLOADS,H?.VITE_VERCEL_ENV",
      ),
    ).toEqual(["VITE_FIREBASE_PROJECT_ID"]);
  });

  it("fails when a preview/download env key is inlined", () => {
    const input = healthyInput();
    input.assetSource = "VITE_R2_DOWNLOADS:`true`";
    const result = evaluateProductionHealth(input);
    expect(
      result.checks.find(
        (check) => check.name === "production asset has no preview/download env overrides",
      )?.status,
    ).toBe("FAIL");
  });
});
