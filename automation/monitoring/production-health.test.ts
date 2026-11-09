import { describe, expect, it } from "vitest";
import {
  evaluateProductionHealth,
  parseInlinedEnvKeys,
  type HarnessResult,
} from "./production-health";

function routeData(overrides: Record<string, unknown> = {}) {
  return {
    page: {
      path: "/",
      posterLinks: Array.from({ length: 63 }, (_, index) => `/poster/p-${index}`),
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
    },
    console: { consoleEvents: [], exceptions: [] },
  };
}

function healthyHarness(): HarnessResult {
  const routes: Record<string, unknown> = {};
  for (const viewport of ["desktop", "mobile"]) {
    routes[`home-${viewport}`] = routeData({
      unavailableIds: ["stranger-things-2", "the-substance-2"],
    });
    routes[`detail-${viewport}`] = routeData({ posterLinks: [] });
    routes[`category-${viewport}`] = routeData({ posterLinks: [] });
    for (const id of ["the-substance-2", "stranger-things-2"]) {
      routes[`unavailable-detail-${id}-${viewport}`] = routeData({
        posterLinks: [],
        unavailableIds: [id],
      });
    }
  }
  return { summary: { checks: 42, passed: 42, failed: 0 }, routes };
}

const healthyInput = () => ({
  harness: healthyHarness(),
  assetSource:
    "const x = H?.VITE_R2_DOWNLOADS; const y = H?.VITE_VERCEL_ENV; const z = `/poster-unavailable.svg`;",
  mappedDetailHtml:
    '<meta property="og:image" content="https://csfzm0ozakaiii5u.public.blob.vercel-storage.com/cineprint/optimized/legacy/backrooms-3.webp">',
});

describe("production health evaluation", () => {
  it("passes a healthy snapshot", () => {
    const result = evaluateProductionHealth(healthyInput());
    expect(result.failed).toBe(0);
    expect(result.checks.length).toBeGreaterThan(20);
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

  it("fails when an unavailable identity is missing", () => {
    const input = healthyInput();
    (input.harness.routes!["home-desktop"] as ReturnType<typeof routeData>).page.unavailableIds = [
      "the-substance-2",
    ];
    const result = evaluateProductionHealth(input);
    expect(
      result.checks.find((check) => check.name === "home desktop: both unavailable identities")
        ?.status,
    ).toBe("FAIL");
  });

  it("supports the final SEO R2 expectation", () => {
    const input = healthyInput();
    input.expectedSeo = "r2";
    input.mappedDetailHtml =
      '<meta property="og:image" content="https://images.cineprint.click/cineprint/optimized/legacy/backrooms-3.webp">';
    const r2Locs = Array.from(
      { length: 61 },
      (_, index) => `<image:loc>https://images.cineprint.click/x${index}.webp</image:loc>`,
    ).join("");
    const placeholder = "<image:loc>https://cineprint.click/poster-unavailable.svg</image:loc>";
    input.sitemapXml = `<urlset>${r2Locs}${placeholder}${placeholder}</urlset>`;
    const result = evaluateProductionHealth(input);
    expect(result.failed).toBe(0);
    expect(result.checks.find((check) => check.name === "mapped detail SEO uses R2")?.status).toBe(
      "PASS",
    );
    expect(
      result.checks.find((check) => check.name === "sitemap uses R2 for mapped posters")?.status,
    ).toBe("PASS");
  });

  it("fails when mapped-detail SEO uses R2", () => {
    const input = healthyInput();
    input.mappedDetailHtml =
      '<meta property="og:image" content="https://images.cineprint.click/cineprint/optimized/legacy/backrooms-3.webp">';
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
