import { describe, expect, it, vi } from "vitest";
import { AppError } from "../../src/server/errors/app-error";
import {
  serializeForLog,
  toPublicError,
  toSuccessBody,
  withEnvelope,
} from "../../src/server/errors/error-response";

describe("toPublicError", () => {
  it("maps known AppErrors to code + public message", () => {
    const err = new AppError("UNAUTHENTICATED", "You need to sign in to continue.");
    expect(toPublicError(err)).toEqual({
      ok: false,
      error: { code: "UNAUTHENTICATED", message: "You need to sign in to continue." },
    });
  });

  it("collapses unknown errors to a generic INTERNAL body", () => {
    const body = toPublicError(new Error("Firestore: permission denied on /var/task/secret"));
    expect(body).toEqual({
      ok: false,
      error: { code: "INTERNAL", message: "Something went wrong. Please try again." },
    });
    expect(JSON.stringify(body)).not.toContain("permission denied");
    expect(JSON.stringify(body)).not.toContain("/var/task");
  });

  it("never exposes stacks, causes, or meta in the client body", () => {
    const cause = new Error("private_key -----BEGIN PRIVATE KEY-----");
    const err = new AppError("INFRASTRUCTURE", "A server dependency is unavailable.", {
      cause,
      meta: { stage: "credential-build" },
    });
    const json = JSON.stringify(toPublicError(err));
    expect(json).not.toContain("PRIVATE KEY");
    expect(json).not.toContain("credential-build");
    expect(json).not.toContain("stack");
  });

  it("handles non-Error throwables without leaking their messages", () => {
    const json = JSON.stringify(toPublicError({ token: "abc", weird: "object" }));
    expect(json).not.toContain("abc");
  });
});

describe("serializeForLog (server-side)", () => {
  it("preserves the full picture for diagnostics", () => {
    const cause = new Error("root cause detail");
    const err = new AppError("INFRASTRUCTURE", "Firestore unavailable", {
      cause,
      statusCode: 503,
      meta: { operation: "account.export" },
    });
    const log = serializeForLog(err) as Record<string, unknown>;
    expect(log.message).toBe("Firestore unavailable");
    expect(log.code).toBe("INFRASTRUCTURE");
    expect(log.statusCode).toBe(503);
    expect((log.meta as Record<string, unknown>).operation).toBe("account.export");
    expect((log.cause as Record<string, unknown>).message).toBe("root cause detail");
    expect(log.stack).toBeDefined();
  });

  it("redacts sensitive keys inside meta and nested structures", () => {
    const err = new AppError("INTERNAL", "boom", {
      meta: {
        authToken: "tok_123",
        Authorization: "Bearer xyz",
        nested: { serviceAccountJson: "{}" },
        safeField: "visible",
      },
    });
    const log = JSON.stringify(serializeForLog(err));
    expect(log).not.toContain("tok_123");
    expect(log).not.toContain("Bearer xyz");
    expect(log).not.toContain('"{}"');
    expect(log).toContain("visible");
    expect(log).toContain("[REDACTED]");
  });

  it("keeps plain errors intact for logging", () => {
    const log = serializeForLog(new Error("plain")) as Record<string, unknown>;
    expect(log.name).toBe("Error");
    expect(log.message).toBe("plain");
  });
});

describe("success envelope", () => {
  it("wraps data with ok:true", () => {
    expect(toSuccessBody({ id: "p1" })).toEqual({ ok: true, data: { id: "p1" } });
  });
});

describe("withEnvelope (shared feature envelope runner)", () => {
  it("resolves successful operations to { ok:true, data } and logs one completion line", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const res = await withEnvelope("feature.op", "user-9", async () => ({ n: 1 }));
      expect(res).toEqual({ ok: true, data: { n: 1 } });

      const logged = logSpy.mock.calls
        .map((args) => args[0])
        .filter((l): l is string => typeof l === "string")
        .map((l) => JSON.parse(l) as Record<string, unknown>);
      const done = logged.find((e) => e.msg === "request completed");
      expect(done?.operation).toBe("feature.op");
      expect(done?.uid).toBe("user-9");
      expect(String(done?.requestId)).toMatch(/^req-/);
      expect(done?.durationMs).toBeTypeOf("number");
    } finally {
      logSpy.mockRestore();
    }
  });

  it("maps thrown AppErrors to their code + public message envelope", async () => {
    const res = await withEnvelope("feature.op", undefined, async () => {
      throw new AppError("VALIDATION_FAILED", "That request wasn't valid.");
    });
    expect(res).toEqual({
      ok: false,
      error: { code: "VALIDATION_FAILED", message: "That request wasn't valid." },
    });
  });

  it("collapses unknown errors to a generic INTERNAL envelope with nothing leaked, and logs the failure", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const res = await withEnvelope("feature.op", "u1", async () => {
        throw new Error("firestore: permission denied secret-path");
      });

      expect(res).toEqual({
        ok: false,
        error: { code: "INTERNAL", message: "Something went wrong. Please try again." },
      });
      const serialized = JSON.stringify(res);
      expect(serialized).not.toContain("permission denied");
      expect(serialized).not.toContain("secret-path");
      expect(serialized).not.toContain("stack");
      expect(serialized).not.toContain("cause");

      const logged = logSpy.mock.calls
        .map((args) => args[0])
        .filter((l): l is string => typeof l === "string")
        .map((l) => JSON.parse(l) as Record<string, unknown>);
      expect(logged.some((e) => e.msg === "request failed" && e.operation === "feature.op")).toBe(
        true,
      );
    } finally {
      logSpy.mockRestore();
    }
  });
});
