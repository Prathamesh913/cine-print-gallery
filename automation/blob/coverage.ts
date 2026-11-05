import { optimizedPathFor, optimizedUrlFor } from "./optimized-path";

export interface CoverageInput {
  id: string;
  image: string;
}

export type CoverageClass = "optimized" | "fallback-original" | "missing-image";

export interface CoverageEntry extends CoverageInput {
  coverageClass: CoverageClass;
  optimizedPath: string | null;
  optimizedUrl: string | null;
  reason: string | null;
}

export interface CoverageReport {
  total: number;
  withOptimized: number;
  fallbackOriginal: number;
  missingImage: number;
  legacy: number;
  artwork: number;
  externalExceptions: number;
  sampleWithOptimized: string[];
  sampleFallback: string[];
  sampleMissing: string[];
  entries: CoverageEntry[];
}

function isExternalImage(url: string): boolean {
  try {
    return new URL(url).hostname === "pbs.twimg.com";
  } catch {
    return false;
  }
}

export function auditOptimizedCoverage(posters: readonly CoverageInput[]): CoverageReport {
  const entries: CoverageEntry[] = posters.map((poster) => {
    const image = poster.image.trim();
    if (!image) {
      return {
        ...poster,
        coverageClass: "missing-image",
        optimizedPath: null,
        optimizedUrl: null,
        reason: "empty image field, excluded from sitemap and rendering",
      };
    }
    const path = optimizedPathFor(poster.id, image);
    if (path) {
      return {
        ...poster,
        coverageClass: "optimized",
        optimizedPath: path,
        optimizedUrl: optimizedUrlFor(poster.id, image),
        reason: null,
      };
    }
    return {
      ...poster,
      coverageClass: "fallback-original",
      optimizedPath: null,
      optimizedUrl: null,
      reason: isExternalImage(image)
        ? "external-image exception, PosterImage falls back to original"
        : "unsupported Blob pathname, PosterImage falls back to original",
    };
  });

  const withOptimized = entries.filter((e) => e.coverageClass === "optimized");
  const fallback = entries.filter((e) => e.coverageClass === "fallback-original");
  const missing = entries.filter((e) => e.coverageClass === "missing-image");

  return {
    total: entries.length,
    withOptimized: withOptimized.length,
    fallbackOriginal: fallback.length,
    missingImage: missing.length,
    legacy: withOptimized.filter((e) => e.optimizedPath?.includes("/legacy/")).length,
    artwork: withOptimized.filter((e) => !e.optimizedPath?.includes("/legacy/")).length,
    externalExceptions: fallback.filter((e) => e.reason?.startsWith("external-image")).length,
    sampleWithOptimized: withOptimized.slice(0, 10).map((e) => e.id),
    sampleFallback: fallback.slice(0, 10).map((e) => e.id),
    sampleMissing: missing.slice(0, 10).map((e) => e.id),
    entries,
  };
}
