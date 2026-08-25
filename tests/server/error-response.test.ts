import { describe, expect, it } from "vitest";
import { AppError } from "../../src/server/errors/app-error";
import {
  serializeForLog,
  toPublicError,
  toSuccessBody,
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
