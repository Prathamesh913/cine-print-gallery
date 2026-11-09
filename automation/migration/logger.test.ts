import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ConsoleSink,
  FileSink,
  LogSinkError,
  MemorySink,
  StructuredLogger,
  safeLogPayload,
} from "./logger";
import { redactHeaders, redactString, redactUrl } from "./redaction";

const RUN = "run-logger-test";
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function draft(overrides: Record<string, unknown> = {}) {
  return {
    runId: RUN,
    type: "poster.started" as const,
    outcome: "started" as const,
    evidence: "mock" as const,
    posterId: "bugonia",
    ...overrides,
  };
}

describe("F20 — safe structured logging", () => {
  it("emits one JSON line per event with redacted fields", () => {
    const sink = new MemorySink();
    const logger = new StructuredLogger({ sinks: [sink] });
    logger.log({
      ...draft(),
      message: "GET https://pbs.twimg.com/media/x?token=secret Authorization: Bearer abc.def",
    });
    expect(sink.lines).toHaveLength(1);
    const parsed = JSON.parse(sink.lines[0]);
    expect(parsed.type).toBe("poster.started");
    expect(sink.lines[0]).not.toContain("secret");
    expect(sink.lines[0]).not.toContain("abc.def");
  });

  it("redacts authorization, cookies, signed query parameters and embedded credentials", () => {
    expect(redactHeaders({ Authorization: "Bearer x", Cookie: "a=b", Accept: "image/*" })).toEqual({
      Authorization: "[REDACTED]",
      Cookie: "[REDACTED]",
      Accept: "image/*",
    });
    const signed =
      "https://bucket.r2.cloudflarestorage.com/key?X-Amz-Signature=abc&X-Amz-Credential=def";
    expect(redactUrl(signed)).not.toContain("abc");
    expect(redactUrl(signed)).not.toContain("def");
    expect(redactString("Authorization: Basic dXNlcjpwYXNz")).not.toContain("dXNlcjpwYXNz");
    expect(redactString("https://user:pass@example.com/x")).not.toContain("pass");
  });

  it("redacts environment-style secret assignments", () => {
    const assignments = [
      "NOTION_KEY=notion-secret",
      "FIREBASE_PRIVATE_KEY=firebase-secret",
      "AWS_SECRET_ACCESS_KEY=aws-secret",
      "CLOUDFLARE_API_TOKEN=cloudflare-secret",
      "R2_SECRET_ACCESS_KEY=r2-secret",
      "VERCEL_OIDC_TOKEN=vercel-secret",
      "API_KEY=api-secret",
      "ACCESS_TOKEN=access-secret",
      "CLIENT_SECRET=client-secret",
      "PASSWORD=password-secret",
      "notion-key=lower-secret",
      "NOTION KEY=space-secret",
    ];
    for (const assignment of assignments) {
      const redacted = redactString(assignment);
      expect(redacted, assignment).toContain("[REDACTED]");
      expect(redacted, assignment).not.toMatch(
        /notion-secret|firebase-secret|aws-secret|cloudflare-secret|r2-secret|vercel-secret|api-secret|access-secret|client-secret|password-secret|lower-secret|space-secret/,
      );
    }
    expect(
      redactString("poster bugonia key cineprint/external/bugonia.jpg sha256 " + "a".repeat(64)),
    ).toContain("bugonia");
  });

  it("never serializes buffers or base64 image payloads", () => {
    const payload = safeLogPayload({
      buffer: Buffer.from("raw-image-bytes"),
      data: `data:image/png;base64,${"A".repeat(400)}`,
    });
    expect(payload).toContain("[BINARY");
    expect(payload).not.toContain("raw-image-bytes");
    expect(payload).not.toContain("base64,");
  });

  it("writes to a local file sink and flushes it", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cineprint-logger-"));
    tempDirs.push(dir);
    const file = path.join(dir, "run.log");
    const sink = new FileSink(file);
    const logger = new StructuredLogger({ sinks: [sink] });
    logger.log({ ...draft(), message: "hello" });
    logger.checkpoint();
    logger.close();
    const lines = fs.readFileSync(file, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).message).toBe("hello");
  });

  it("throws on a sink failure so a run cannot report false success", () => {
    const broken = {
      name: "broken",
      write() {
        throw new Error("disk full");
      },
    };
    const logger = new StructuredLogger({ sinks: [broken] });
    expect(() => logger.log(draft())).toThrow(LogSinkError);
    expect(logger.isHealthy()).toBe(false);
    expect(logger.failures[0].sink).toBe("broken");
  });

  it("can collect sink failures but requires assertHealthy before success", () => {
    const broken = {
      name: "broken",
      write() {
        throw new Error("permission denied");
      },
    };
    const logger = new StructuredLogger({
      sinks: [broken],
      sinkFailurePolicy: "collect",
    });
    expect(() => logger.log(draft())).not.toThrow();
    expect(logger.isHealthy()).toBe(false);
    expect(() => logger.assertHealthy()).toThrow(/unhealthy/);
  });

  it("keeps console output structured and redacted", () => {
    const lines: string[] = [];
    const logger = new StructuredLogger({
      sinks: [new ConsoleSink((line) => lines.push(line))],
    });
    logger.log({ ...draft(), message: "Bearer top-secret" });
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("top-secret");
    expect(() => JSON.parse(lines[0])).not.toThrow();
  });
});
