export type CheckStatus = "PASS" | "FAIL" | "WARNING";

export interface HealthCheck {
  name: string;
  status: CheckStatus;
  detail?: unknown;
}

export interface HarnessRoute {
  page?: {
    path?: string;
    posterLinks?: string[];
    r2Count?: number;
    blobCount?: number;
    brokenCount?: number;
    unavailableIds?: string[];
  };
  network?: {
    rows?: Array<{ url: string; status?: number | null; failed?: boolean }>;
    failed?: unknown[];
    otherHosts?: string[];
  };
  console?: {
    consoleEvents?: Array<{ type?: string }>;
    exceptions?: unknown[];
  };
}

export interface HarnessResult {
  summary?: { checks?: number; passed?: number; failed?: number };
  routes?: Record<string, HarnessRoute>;
}

export interface HealthInput {
  harness: HarnessResult;
  assetSource: string;
  mappedDetailHtml: string;
  sitemapXml?: string;
  expectedSeo?: "blob" | "r2";
}

const UNAVAILABLE_IDS = new Set(["stranger-things-2", "the-substance-2"]);
const R2_HOST = "images.cineprint.click";
const LOCAL_PREVIEW_HOSTS = new Set(["cineprint.click", "127.0.0.1", "localhost"]);

/** Inlined Vite env keys in a built client asset. Property reads are ignored. */
export function parseInlinedEnvKeys(assetSource: string): string[] {
  return [
    ...new Set(
      [...assetSource.matchAll(/VITE_[A-Z0-9_]+:/g)].map((match) => match[0].slice(0, -1)),
    ),
  ];
}

function route(harness: HarnessResult, key: string): HarnessRoute | undefined {
  return harness.routes?.[key];
}

function imageHost(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function duplicateImageUrls(routeData: HarnessRoute | undefined): number {
  // Count poster-delivery images only. Browsers may request favicons/touch
  // icons more than once; those are not poster delivery regressions.
  const rows = (routeData?.network?.rows ?? []).filter((row) => {
    const host = imageHost(row.url);
    return host === R2_HOST || row.url.endsWith("/poster-unavailable.svg");
  });
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.url, (counts.get(row.url) ?? 0) + 1);
  return [...counts.values()].filter((count) => count > 1).length;
}

function consoleErrorCount(routeData: HarnessRoute | undefined): number {
  return (routeData?.console?.consoleEvents ?? []).filter((event) => event.type === "error").length;
}

export function evaluateProductionHealth(input: HealthInput): {
  checks: HealthCheck[];
  failed: number;
  warnings: number;
} {
  const checks: HealthCheck[] = [];
  const add = (name: string, ok: boolean, detail?: unknown) =>
    checks.push({ name, status: ok ? "PASS" : "FAIL", detail });
  const warn = (name: string, detail?: unknown) => checks.push({ name, status: "WARNING", detail });

  const harness = input.harness;
  const summary = harness.summary ?? {};
  add(
    "route harness completed",
    (summary.failed ?? 1) === 0 && (summary.checks ?? 0) >= 42,
    summary,
  );

  for (const viewport of ["desktop", "mobile"]) {
    const home = route(harness, `home-${viewport}`);
    add(`home ${viewport}: 63 poster links`, home?.page?.posterLinks?.length === 63, {
      links: home?.page?.posterLinks?.length,
    });
    add(`home ${viewport}: R2 delivery active`, (home?.page?.r2Count ?? 0) > 0, {
      r2: home?.page?.r2Count,
    });
    add(`home ${viewport}: no Blob images`, (home?.page?.blobCount ?? 1) === 0, {
      blob: home?.page?.blobCount,
    });
    add(`home ${viewport}: no broken images`, (home?.page?.brokenCount ?? 1) === 0, {
      broken: home?.page?.brokenCount,
    });
    const unavailable = new Set(home?.page?.unavailableIds ?? []);
    add(
      `home ${viewport}: both unavailable identities`,
      unavailable.size === 2 && [...UNAVAILABLE_IDS].every((id) => unavailable.has(id)),
      { unavailable: [...unavailable] },
    );

    const detail = route(harness, `detail-${viewport}`);
    add(
      `detail ${viewport}: R2 delivery`,
      (detail?.page?.r2Count ?? 0) > 0 && (detail?.page?.blobCount ?? 1) === 0,
      { r2: detail?.page?.r2Count, blob: detail?.page?.blobCount },
    );
    add(`detail ${viewport}: no broken images`, (detail?.page?.brokenCount ?? 1) === 0, {
      broken: detail?.page?.brokenCount,
    });

    for (const id of UNAVAILABLE_IDS) {
      const unavailableRoute = route(harness, `unavailable-detail-${id}-${viewport}`);
      add(
        `unavailable ${id} ${viewport}: placeholder and no Blob`,
        (unavailableRoute?.page?.unavailableIds ?? []).includes(id) &&
          (unavailableRoute?.page?.blobCount ?? 1) === 0 &&
          (unavailableRoute?.page?.brokenCount ?? 1) === 0,
        {
          unavailable: unavailableRoute?.page?.unavailableIds,
          blob: unavailableRoute?.page?.blobCount,
          broken: unavailableRoute?.page?.brokenCount,
        },
      );
    }

    const category = route(harness, `category-${viewport}`);
    add(
      `category ${viewport}: R2 delivery and no broken images`,
      (category?.page?.r2Count ?? 0) > 0 &&
        (category?.page?.blobCount ?? 1) === 0 &&
        (category?.page?.brokenCount ?? 1) === 0,
      {
        r2: category?.page?.r2Count,
        blob: category?.page?.blobCount,
        broken: category?.page?.brokenCount,
      },
    );

    for (const [key, routeData] of Object.entries(harness.routes ?? {})) {
      if (!key.endsWith(viewport)) continue;
      add(
        `${key}: no console errors or exceptions`,
        consoleErrorCount(routeData) === 0 && (routeData.console?.exceptions ?? []).length === 0,
        {
          consoleErrors: consoleErrorCount(routeData),
          exceptions: routeData.console?.exceptions ?? [],
        },
      );
      add(`${key}: no duplicate image requests`, duplicateImageUrls(routeData) === 0, {
        duplicateUrls: duplicateImageUrls(routeData),
      });
      const failedImages = (routeData.network?.failed ?? []).length;
      add(`${key}: no failed image requests`, failedImages === 0, { failed: failedImages });
      const otherHosts = (routeData.network?.otherHosts ?? []).filter(
        (host) => !LOCAL_PREVIEW_HOSTS.has(host),
      );
      add(`${key}: no unexpected image hosts`, otherHosts.length === 0, {
        otherHosts,
      });
    }
  }

  const envKeys = parseInlinedEnvKeys(input.assetSource);
  add(
    "production asset has no preview/download env overrides",
    !envKeys.includes("VITE_R2_DOWNLOADS") &&
      !envKeys.includes("VITE_VERCEL_ENV") &&
      !envKeys.includes("VITE_R2_BROWSER_IMAGES"),
    { envKeys },
  );
  add(
    "production asset contains browser activation code",
    input.assetSource.includes("VITE_R2_DOWNLOADS") &&
      input.assetSource.includes("poster-unavailable.svg"),
    undefined,
  );

  const expectedSeo = input.expectedSeo ?? "blob";
  const ogImage = /<meta property="og:image" content="([^"]+)"/.exec(input.mappedDetailHtml)?.[1];
  const ogHost = ogImage ? imageHost(ogImage) : null;
  add(
    expectedSeo === "r2" ? "mapped detail SEO uses R2" : "mapped detail SEO remains off R2",
    expectedSeo === "r2"
      ? Boolean(ogImage) && ogHost === R2_HOST
      : Boolean(ogImage) && ogHost !== R2_HOST,
    { ogImage, host: ogHost },
  );

  if (input.sitemapXml) {
    const imageLocs = [...input.sitemapXml.matchAll(/<image:loc>([^<]+)<\/image:loc>/g)].map(
      (match) => match[1],
    );
    const hosts = new Map<string, number>();
    for (const loc of imageLocs) {
      const host = imageHost(loc);
      if (host) hosts.set(host, (hosts.get(host) ?? 0) + 1);
    }
    const r2Count = hosts.get(R2_HOST) ?? 0;
    const blobCount = hosts.get("csfzm0ozakaiii5u.public.blob.vercel-storage.com") ?? 0;
    add(
      expectedSeo === "r2"
        ? "sitemap uses R2 for mapped posters"
        : "sitemap remains Blob while SEO is disabled",
      expectedSeo === "r2"
        ? imageLocs.length === 63 && r2Count === 61 && blobCount === 0
        : imageLocs.length === 63 && blobCount === 63 && r2Count === 0,
      { total: imageLocs.length, r2Count, blobCount },
    );
  }

  if (envKeys.includes("VITE_R2_DOWNLOADS") || envKeys.includes("VITE_VERCEL_ENV")) {
    warn("download flag env override present", { envKeys });
  }

  return {
    checks,
    failed: checks.filter((check) => check.status === "FAIL").length,
    warnings: checks.filter((check) => check.status === "WARNING").length,
  };
}
