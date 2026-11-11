import { describe, expect, it } from "vitest";
import { ConfigError, loadPipelineConfig } from "./config";
import { createLogger, createMemoryLoggerSink } from "./logger";

const BASE_ENV = {
  RAINDROP_ACCESS_TOKEN: "raindrop-secret",
  RAINDROP_COLLECTION_ID: "42",
  TMDB_API_KEY: "tmdb-secret",
  NOTION_KEY: "notion-secret",
  NOTION_DATABASE_ID: "db",
};

describe("pipeline configuration", () => {
  it("loads a dry-run configuration without R2 credentials", () => {
    const config = loadPipelineConfig(BASE_ENV, { requireR2: false });
    expect(config.r2).toBeNull();
    expect(config.concurrency).toBe(2);
    expect(config.batchLimit).toBe(25);
  });

  it("requires the complete R2 set when any R2 value is present", () => {
    expect(() =>
      loadPipelineConfig({ ...BASE_ENV, R2_ACCOUNT_ID: "account" }, { requireR2: false }),
    ).toThrow(ConfigError);
  });

  it("requires R2 credentials for apply runs", () => {
    expect(() => loadPipelineConfig(BASE_ENV, { requireR2: true })).toThrow(
      "Missing required environment variable: R2_ACCOUNT_ID",
    );
  });

  it("names a missing variable without echoing a secret", () => {
    try {
      loadPipelineConfig({ ...BASE_ENV, RAINDROP_ACCESS_TOKEN: "" }, { requireR2: false });
      throw new Error("expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect(String(error)).toContain("RAINDROP_ACCESS_TOKEN");
      expect(String(error)).not.toContain("raindrop-secret");
    }
  });

  it("treats the poster identities data source as optional", () => {
    const without = loadPipelineConfig(BASE_ENV, { requireR2: false });
    expect(without.notion.identitiesDataSourceId).toBeNull();

    const withId = loadPipelineConfig(
      { ...BASE_ENV, NOTION_POSTER_IDENTITIES_DATA_SOURCE_ID: "ds-identities" },
      { requireR2: false },
    );
    expect(withId.notion.identitiesDataSourceId).toBe("ds-identities");
  });
});

describe("structured logger", () => {
  it("redacts bearer tokens and credential query parameters", () => {
    const sink = createMemoryLoggerSink();
    const logger = createLogger({
      runId: "run-1",
      mode: "ingest",
      dryRun: true,
      stream: sink.stream,
      now: () => new Date("2026-11-10T00:00:00.000Z"),
    });

    logger.error("request.failed", {
      reason: "Authorization: Bearer super-secret-token",
      url: "https://example.com/a.png?access_token=also-secret",
    });

    expect(sink.lines).toHaveLength(1);
    expect(sink.lines[0]).not.toContain("super-secret-token");
    expect(sink.lines[0]).not.toContain("also-secret");
    expect(JSON.parse(sink.lines[0])).toMatchObject({
      level: "error",
      runId: "run-1",
      event: "request.failed",
    });
  });

  it("supports child context", () => {
    const sink = createMemoryLoggerSink();
    const logger = createLogger({
      runId: "run-1",
      mode: "ingest",
      dryRun: true,
      stream: sink.stream,
    });

    logger.child({ posterId: "artwork-1" }).info("stage.complete");
    expect(JSON.parse(sink.lines[0]).posterId).toBe("artwork-1");
  });
});
