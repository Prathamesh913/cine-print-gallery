import { describe, expect, it } from "vitest";
import { createLogger, withLogging } from "../../src/server/request/logging";
import { createRequestId, requestIdFromHeader } from "../../src/server/request/context";

function capture(): { lines: string[]; logger: ReturnType<typeof createLogger> } {
  const lines: string[] = [];
  return { lines, logger: createLogger({ requestId: "req-test-0" }, { sink: (l) => lines.push(l) }) };
}

describe("structured logger", () => {
  it("emits single-line JSON with context fields", () => {
    const { lines, logger } = capture();
    logger.info("poster saved", { posterId: "p1" });
    const parsed = JSON.parse(lines[0]);
    expect(parsed).toMatchObject({
      level: "info",
      msg: "poster saved",
      requestId: "req-test-0",
      posterId: "p1",
    });
    expect(lines[0]).not.toMatch(/\n/);
  });

  it("supports warn and error levels", () => {
    const { lines, logger } = capture();
    logger.warn("slow query", { ms: 900 });
    logger.error("failed hard");
    expect(JSON.parse(lines[0]).level).toBe("warn");
    expect(JSON.parse(lines[1]).level).toBe("error");
  });

  it("includes operation and uid only when present", () => {
    const lines: string[] = [];
    const logger = createLogger(
      { requestId: "r1", operation: "account.export", uid: "user-9" },
      { sink: (l) => lines.push(l) },
    );
    logger.info("done");
    const parsed = JSON.parse(lines[0]);
    expect(parsed.operation).toBe("account.export");
    expect(parsed.uid).toBe("user-9");

    const bare = capture();
    bare.logger.info("no ctx");
    expect(JSON.parse(bare.lines[0])).not.toHaveProperty("uid");
  });

  it("redacts sensitive metadata keys recursively — tokens never emitted", () => {
    const { lines, logger } = capture();
    logger.info("auth attempt", {
      idToken: "eyJhbGciOi.XXXX.YYYY",
      authorizationHeader: "Bearer abc",
      refreshToken: "r1",
      nested: { firebaseToken: "f1", ok: "keep-me" },
    });
    const raw = lines.join("\n");
    expect(raw).not.toContain("eyJhbGciOi");
    expect(raw).not.toContain("Bearer abc");
    expect(raw).not.toContain('"r1"');
    expect(raw).not.toContain("f1");
    expect(JSON.parse(lines[0]).nested.ok).toBe("keep-me");
  });

  it("withLogging logs completion with durationMs and rethrows failures", async () => {
    const { lines, logger } = capture();
    await withLogging(logger, "op.ok", async () => 42);
    const okLine = JSON.parse(lines[0]);
    expect(okLine.msg).toBe("request completed");
    expect(typeof okLine.durationMs).toBe("number");

    await expect(
      withLogging(logger, "op.fail", async () => {
        throw new Error("x");
      }),
    ).rejects.toThrow("x");
    expect(JSON.parse(lines[1]).msg).toBe("request failed");
    expect(JSON.parse(lines[1]).level).toBe("error");
  });
});

describe("request ids", () => {
  it("generates unique URL-safe IDs", () => {
    const a = createRequestId();
    const b = createRequestId();
    expect(a).toMatch(/^req-[a-z0-9]+-[a-z0-9]+$/);
    expect(a).not.toBe(b);
  });

  it("preserves well-formed supplied IDs, rejects malformed ones", () => {
    expect(requestIdFromHeader("client-id-123")).toBe("client-id-123");
    // Injection-shaped input must not be echoed into logs.
    const evil = 'bad id\n{"injected":true}';
    expect(requestIdFromHeader(evil)).toMatch(/^req-/);
    expect(requestIdFromHeader(undefined)).toMatch(/^req-/);
  });
});
