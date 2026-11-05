import { describe, expect, it } from "vitest";
import { auditOptimizedCoverage } from "./coverage";

const BLOB = "https://csfzm0ozakaiii5u.public.blob.vercel-storage.com";

describe("optimized coverage audit", () => {
  it("counts artwork records as optimized with derived paths", () => {
    const report = auditOptimizedCoverage([
      { id: "artwork-1812274995", image: `${BLOB}/cineprint/raindrop/1812274995.png` },
    ]);
    expect(report.withOptimized).toBe(1);
    expect(report.artwork).toBe(1);
    expect(report.entries[0].optimizedPath).toBe("cineprint/optimized/1812274995.webp");
  });

  it("counts legacy records as optimized with legacy paths", () => {
    const report = auditOptimizedCoverage([
      { id: "backrooms-1", image: `${BLOB}/cineprint/raindrop/1779301125.png` },
    ]);
    expect(report.withOptimized).toBe(1);
    expect(report.legacy).toBe(1);
    expect(report.entries[0].optimizedPath).toBe("cineprint/optimized/legacy/backrooms-1.webp");
  });

  it("flags external images as fallback exceptions", () => {
    const report = auditOptimizedCoverage([
      { id: "her", image: "https://pbs.twimg.com/media/example.jpg" },
    ]);
    expect(report.fallbackOriginal).toBe(1);
    expect(report.externalExceptions).toBe(1);
    expect(report.sampleFallback).toEqual(["her"]);
  });

  it("flags missing images separately from fallbacks", () => {
    const report = auditOptimizedCoverage([{ id: "empty", image: "  " }]);
    expect(report.missingImage).toBe(1);
    expect(report.fallbackOriginal).toBe(0);
  });

  it("reports exact counts with representative samples", () => {
    const report = auditOptimizedCoverage([
      { id: "artwork-1", image: `${BLOB}/cineprint/raindrop/1.png` },
      { id: "old-1", image: `${BLOB}/cineprint/raindrop/2.png` },
      { id: "her", image: "https://pbs.twimg.com/media/example.jpg" },
    ]);
    expect(report.total).toBe(3);
    expect(report.withOptimized).toBe(2);
    expect(report.fallbackOriginal).toBe(1);
    expect(report.sampleWithOptimized).toHaveLength(2);
  });
});
