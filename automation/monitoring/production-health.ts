import {
  POSTER_UNAVAILABLE_ABSOLUTE_URL,
  createPosterImageResolver,
} from "../../src/lib/poster-images";
import { validateR2ImageReference } from "../../src/lib/r2-image-reference";
import type { R2ImageMapEntry } from "../../src/lib/r2-image-map.generated";
import type { Poster } from "../../src/lib/posters";

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
    blobRequests?: number;
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

/**
 * A published catalogue row as read from Firestore. `image` is the legacy
 * Blob identity the static map is keyed against; `r2Image` is the optional
 * dynamic reference used by posters created after the one-time migration.
 */
export interface CataloguePoster {
  id: string;
  image: string;
  r2Image?: unknown;
}

/** The generated static map (`src/lib/r2-image-map.generated.ts`). */
export type StaticImageMap = Readonly<Record<string, R2ImageMapEntry>>;

/** The result of fetching one poster's public optimized image. */
export interface PublicImageCheck {
  posterId: string;
  url: string | null;
  ok: boolean;
  status: number | null;
  contentType: string | null;
  contentLength?: number | null;
  reason?: string | null;
}

/** How one published poster resolves through the production image contract. */
export interface CatalogueImageResolution {
  posterId: string;
  /** Trusted R2 optimized URL, or null when the poster does not resolve to R2. */
  optimizedUrl: string | null;
  /** Production SEO image URL (the neutral placeholder when fail-closed). */
  seoUrl: string;
  /** Effective URL before the R2-host filter; exposes a legacy Blob fallback. */
  effectiveUrl: string | null;
  /** True when production would render the neutral unavailable placeholder. */
  unavailable: boolean;
  /** True when Firestore supplied an `r2Image` that fails validation. */
  invalidReference: boolean;
}

export interface HealthInput {
  harness: HarnessResult;
  assetSource: string;
  mappedDetailHtml: string;
  sitemapXml?: string;
  expectedSeo?: "blob" | "r2";
  catalogue: CataloguePoster[];
  staticMap: StaticImageMap;
  publicImages: PublicImageCheck[];
}

const R2_HOST = "images.cineprint.click";
const BLOB_HOST = "csfzm0ozakaiii5u.public.blob.vercel-storage.com";
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

function uniqueIds(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function asPoster(poster: CataloguePoster): Poster {
  return {
    id: poster.id,
    image: poster.image,
    ...(poster.r2Image !== undefined && poster.r2Image !== null ? { r2Image: poster.r2Image } : {}),
  } as Poster;
}

/**
 * Resolves one catalogue row exactly the way the production resolver does:
 * the trusted static map entry first, then a validated dynamic `r2Image`, with
 * intentionally unavailable identities failing closed to the placeholder.
 */
export function resolveCatalogueImage(
  poster: CataloguePoster,
  staticMap: StaticImageMap,
): CatalogueImageResolution {
  const resolver = createPosterImageResolver(staticMap, {
    browserEnabled: true,
    seoEnabled: true,
    downloadsEnabled: true,
  });
  const candidate = asPoster(poster);
  const effectiveUrl = resolver.getOptimizedPosterImageUrl(candidate);
  const seoUrl = resolver.getPosterSeoImageUrl(candidate);
  const optimizedUrl = effectiveUrl && imageHost(effectiveUrl) === R2_HOST ? effectiveUrl : null;
  const invalidReference =
    poster.r2Image !== undefined &&
    poster.r2Image !== null &&
    !validateR2ImageReference(poster.r2Image, poster.id).ok;
  return {
    posterId: poster.id,
    optimizedUrl,
    seoUrl,
    effectiveUrl,
    unavailable: seoUrl === POSTER_UNAVAILABLE_ABSOLUTE_URL,
    invalidReference,
  };
}

interface SitemapPosterImage {
  loc: string;
  image: string | null;
}

function parseSitemapPosterImages(xml: string): SitemapPosterImage[] {
  return [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)]
    .map((match) => {
      const block = match[1];
      const loc = /<loc>([^<]+)<\/loc>/.exec(block)?.[1] ?? "";
      const image = /<image:loc>([^<]+)<\/image:loc>/.exec(block)?.[1] ?? null;
      return loc.includes("/poster/") ? { loc, image } : null;
    })
    .filter((entry): entry is SitemapPosterImage => Boolean(entry));
}

function posterIdFromLoc(loc: string): string | null {
  const match = /\/poster\/([^/?#]+)\/?$/.exec(loc);
  return match?.[1] ?? null;
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

  // Catalogue resolution identical to production: static map first, then the
  // validated dynamic reference. Counts are derived from Firestore, never
  // hard-coded, so the monitor follows the real published catalogue.
  const catalogueIds = input.catalogue.map((poster) => poster.id);
  const duplicateIds = uniqueIds(
    catalogueIds.filter((id, index) => catalogueIds.indexOf(id) !== index),
  );
  const resolutions = new Map(
    input.catalogue.map((poster) => [poster.id, resolveCatalogueImage(poster, input.staticMap)]),
  );
  const r2Ids = catalogueIds.filter((id) => resolutions.get(id)?.optimizedUrl);
  const failedR2Ids = catalogueIds.filter((id) => !resolutions.get(id)?.optimizedUrl);
  const legacyIds = failedR2Ids.filter((id) => {
    const resolution = resolutions.get(id);
    return Boolean(resolution?.effectiveUrl) && !resolution?.unavailable;
  });
  const invalidIds = catalogueIds.filter((id) => resolutions.get(id)?.invalidReference);
  const placeholderIds = catalogueIds.filter((id) => resolutions.get(id)?.unavailable);

  const publicById = new Map(input.publicImages.map((entry) => [entry.posterId, entry]));
  const badPublicIds: string[] = [];
  const wrongPublicIds: string[] = [];
  const missingPublicIds: string[] = [];
  for (const id of r2Ids) {
    const resolution = resolutions.get(id)!;
    const publicCheck = publicById.get(id);
    if (!publicCheck) {
      missingPublicIds.push(id);
      continue;
    }
    if (!publicCheck.ok || publicCheck.status !== 200 || publicCheck.contentType !== "image/webp") {
      badPublicIds.push(id);
      continue;
    }
    if (publicCheck.url !== resolution.optimizedUrl) {
      wrongPublicIds.push(id);
    }
  }
  const expectedPublicIds = new Set(r2Ids);
  for (const entry of input.publicImages) {
    if (!expectedPublicIds.has(entry.posterId)) badPublicIds.push(entry.posterId);
  }

  add("catalogue has published posters", input.catalogue.length > 0, {
    published: input.catalogue.length,
  });
  add("catalogue has no duplicate poster IDs", duplicateIds.length === 0, {
    duplicates: duplicateIds,
  });
  add("every published poster resolves to an R2 optimized image", failedR2Ids.length === 0, {
    published: input.catalogue.length,
    r2Backed: r2Ids.length,
    failedIds: uniqueIds(failedR2Ids),
    legacyBlobIds: uniqueIds(legacyIds),
  });
  add("no published poster has an invalid r2Image reference", invalidIds.length === 0, {
    invalidIds: uniqueIds(invalidIds),
  });
  add("no published poster renders the unavailable placeholder", placeholderIds.length === 0, {
    placeholderIds: uniqueIds(placeholderIds),
  });
  add("all published posters have public R2 delivery", badPublicIds.length === 0, {
    failedIds: uniqueIds(badPublicIds),
    published: input.catalogue.length,
  });
  add("all published posters have a public image check", missingPublicIds.length === 0, {
    missingIds: uniqueIds(missingPublicIds),
  });
  add("public image URLs match each poster r2Image", wrongPublicIds.length === 0, {
    mismatchedIds: uniqueIds(wrongPublicIds),
  });

  for (const viewport of ["desktop", "mobile"]) {
    const home = route(harness, `home-${viewport}`);
    add(
      `home ${viewport}: poster links match published catalogue`,
      home?.page?.posterLinks?.length === input.catalogue.length,
      { links: home?.page?.posterLinks?.length, published: input.catalogue.length },
    );
    add(`home ${viewport}: R2 delivery active`, (home?.page?.r2Count ?? 0) > 0, {
      r2: home?.page?.r2Count,
    });
    add(`home ${viewport}: no Blob images`, (home?.page?.blobCount ?? 1) === 0, {
      blob: home?.page?.blobCount,
    });
    add(`home ${viewport}: no broken images`, (home?.page?.brokenCount ?? 1) === 0, {
      broken: home?.page?.brokenCount,
    });
    const unavailable = uniqueIds(home?.page?.unavailableIds ?? []);
    add(`home ${viewport}: zero intentional placeholders`, unavailable.length === 0, {
      unavailableIds: unavailable,
    });

    const detail = route(harness, `detail-${viewport}`);
    add(
      `detail ${viewport}: R2 delivery`,
      (detail?.page?.r2Count ?? 0) > 0 && (detail?.page?.blobCount ?? 1) === 0,
      { r2: detail?.page?.r2Count, blob: detail?.page?.blobCount },
    );
    add(`detail ${viewport}: no broken images`, (detail?.page?.brokenCount ?? 1) === 0, {
      broken: detail?.page?.brokenCount,
    });

    // The browser harness records repaired detail routes under
    // `repaired-detail-<posterId>-<viewport>`. Iterate the actual routes rather
    // than hard-coding the repaired IDs here.
    for (const [key, routeData] of Object.entries(harness.routes ?? {})) {
      if (!key.startsWith("repaired-detail-") || !key.endsWith(`-${viewport}`)) continue;
      const posterId = key.slice("repaired-detail-".length, -`-${viewport}`.length);
      add(
        `repaired detail ${posterId} ${viewport}: R2 image rendered`,
        routeData.page?.path === `/poster/${posterId}` &&
          (routeData.page?.r2Count ?? 0) > 0 &&
          !(routeData.page?.unavailableIds ?? []).includes(posterId),
        {
          path: routeData.page?.path,
          r2: routeData.page?.r2Count,
          unavailableIds: routeData.page?.unavailableIds,
        },
      );
      add(
        `repaired detail ${posterId} ${viewport}: zero Blob and broken images`,
        (routeData.page?.blobCount ?? 1) === 0 &&
          (routeData.page?.brokenCount ?? 1) === 0 &&
          (routeData.network?.blobRequests ?? 1) === 0,
        {
          blobImages: routeData.page?.blobCount,
          blobRequests: routeData.network?.blobRequests,
          brokenCount: routeData.page?.brokenCount,
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

  const expectedSeo = input.expectedSeo ?? "r2";
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
    const entries = parseSitemapPosterImages(input.sitemapXml);
    const images = entries
      .map((entry) => entry.image)
      .filter((image): image is string => Boolean(image));
    const hosts = new Map<string, number>();
    for (const image of images) {
      const host = imageHost(image);
      if (host) hosts.set(host, (hosts.get(host) ?? 0) + 1);
    }
    const r2Count = hosts.get(R2_HOST) ?? 0;
    const blobCount = hosts.get(BLOB_HOST) ?? 0;
    const placeholderCount = entries.filter((entry) =>
      entry.image?.endsWith("/poster-unavailable.svg"),
    ).length;
    const byId = new Map(
      entries
        .map((entry) => [posterIdFromLoc(entry.loc), entry.image] as const)
        .filter((entry): entry is [string, string | null] => Boolean(entry[0])),
    );
    const missingSitemapIds = catalogueIds.filter((id) => !byId.has(id));
    const missingImageIds = catalogueIds.filter((id) => byId.has(id) && !byId.get(id));
    const mismatchedSitemapIds = catalogueIds.filter((id) => {
      const expected = resolutions.get(id)?.seoUrl;
      return Boolean(expected) && byId.get(id) !== expected;
    });

    if (expectedSeo === "r2") {
      add("sitemap contains every published poster", missingSitemapIds.length === 0, {
        missingIds: uniqueIds(missingSitemapIds),
      });
      add("sitemap gives every published poster an image", missingImageIds.length === 0, {
        missingImageIds: uniqueIds(missingImageIds),
      });
      add(
        "sitemap uses each poster's R2 optimized URL",
        mismatchedSitemapIds.length === 0 && r2Count === input.catalogue.length && blobCount === 0,
        {
          total: entries.length,
          r2Count,
          blobCount,
          placeholderCount,
          mismatchedIds: uniqueIds(mismatchedSitemapIds),
        },
      );
      add("sitemap has zero intentional placeholders", placeholderCount === 0, {
        placeholderCount,
      });
    } else {
      add(
        "sitemap remains Blob while SEO is disabled",
        images.length === input.catalogue.length &&
          blobCount === input.catalogue.length &&
          r2Count === 0 &&
          placeholderCount === 0,
        { total: images.length, r2Count, blobCount, placeholderCount },
      );
    }
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
