import { describe, expect, it, vi, beforeEach } from "vitest";
import { AppError } from "../../src/server/errors/app-error";
import { FirebaseAdminError } from "../../src/server/firebase/admin";

/**
 * Tests for the Phase 1 auth middleware foundation.
 *
 * Exercises the REAL TanStack Start function-middleware object by invoking
 * its `.server()` handler exactly as createServerFn would (data/context/next),
 * with only the token verifier mocked.
 */

const verifyState = vi.hoisted(() => ({
  impl: null as ((token: string) => Promise<string>) | null,
}));

vi.mock("../../src/lib/server-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/server-auth")>();
  return {
    // Keep the real FirebaseAdminError re-export so instanceof stays consistent.
    ...actual,
    verifyTokenUid: async (token: string) => {
      if (!verifyState.impl) throw new Error("no verifier configured");
      return verifyState.impl(token);
    },
  };
});

import { authMiddleware } from "../../src/lib/auth-middleware";

type NextCall = { context?: Record<string, unknown> } | undefined;

function runMiddleware(data: unknown, context: Record<string, unknown> = {}) {
  const nextCalls: NextCall[] = [];
  const result = (
    authMiddleware as unknown as {
      options: {
        server: (o: {
          data: unknown;
          context: Record<string, unknown>;
          next: (ctx?: { context?: Record<string, unknown> }) => Promise<unknown>;
        }) => Promise<unknown>;
      };
    }
  ).options.server({
    data,
    context,
    next: async (ctx) => {
      nextCalls.push(ctx);
      return { ok: true, injectedContext: ctx?.context };
    },
  });
  // `result` is the raw promise so rejection-path tests can capture throws;
  // success-path tests must await it before asserting on nextCalls.
  return { result, nextCalls };
}

beforeEach(() => {
  verifyState.impl = null;
});

describe("authMiddleware", () => {
  it("verifies the payload token and injects the VERIFIED uid into context", async () => {
    verifyState.impl = async () => "user-verified-1";
    const { result, nextCalls } = runMiddleware(
      { token: "good-token", posterId: "p1" },
      { extra: "kept" },
    );
    const res = (await result) as { injectedContext?: Record<string, unknown> };

    expect(nextCalls).toHaveLength(1);
    expect(res.injectedContext?.uid).toBe("user-verified-1");
    // Existing context is preserved alongside the injected identity.
    expect(res.injectedContext).toMatchObject({ extra: "kept" });
  });

  it("rejects missing credentials with a client-safe UNAUTHENTICATED error", async () => {
    const { result } = runMiddleware({});
    const err = await result.then(
      () => null,
      (e: unknown) => e as AppError,
    );
    expect(err).toBeInstanceOf(AppError);
    expect(err?.code).toBe("UNAUTHENTICATED");
    expect(err?.statusCode).toBe(401);
    // Safe public message only.
    expect(err?.message).not.toContain("token");
  });

  it("maps invalid tokens to UNAUTHORIZED without exposing internals", async () => {
    verifyState.impl = async () => {
      const failure = new Error("Firebase ID token has invalid aud claim.") as Error & {
        code?: string;
      };
      failure.code = "auth/argument-error";
      throw failure;
    };

    const { result } = runMiddleware({ token: "bad" });
    const err = await result.then(
      () => null,
      (e: unknown) => e as AppError,
    );
    expect(err).toBeInstanceOf(AppError);
    expect(err?.code).toBe("UNAUTHORIZED");
    expect(err?.statusCode).toBe(403);
    // Raw driver message must not reach clients...
    expect(err?.message).not.toContain("aud claim");
    // ...but stays on the cause for server logs.
    expect((err?.cause as Error)?.message).toContain("invalid aud");
  });

  it("propagates FirebaseAdminError so config failures stay visible", async () => {
    verifyState.impl = async () => {
      throw new FirebaseAdminError(
        "module-load",
        "Failed to load firebase-admin/app at runtime.",
      );
    };

    const { result } = runMiddleware({ token: "any" });
    const err = await result.then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(FirebaseAdminError);
    expect((err as FirebaseAdminError).stage).toBe("module-load");
    // NOT masked as an auth failure.
    expect(err).not.toBeInstanceOf(AppError);
  });

  it("never trusts a client-declared uid field", async () => {
    verifyState.impl = async () => "real-uid";
    const { result } = await runMiddleware({
      token: "t",
      uid: "client-forged-uid",
    });
    const res = (await result) as { injectedContext?: { uid?: string } };
    expect(res.injectedContext?.uid).toBe("real-uid");
  });
});
