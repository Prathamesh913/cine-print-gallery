import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  verifyTokenUid,
  optionalViewerUid,
  FirebaseAdminError,
} from "../../src/lib/server-auth";
import { AppError } from "../../src/server/errors/app-error";

const verifyIdToken = vi.fn();
vi.mock("../../src/server/firebase/admin", () => {
  // Minimal stand-in matching the real class shape used for instanceof checks.
  class FirebaseAdminError extends Error {
    stage: string;
    constructor(stage: string, message: string) {
      super(`[firebase-admin/${stage}] ${message}`);
      this.name = "FirebaseAdminError";
      this.stage = stage;
    }
  }
  return {
    getAdminAuth: () => Promise.resolve({ verifyIdToken }),
    FirebaseAdminError,
  };
});

/**
 * Coverage for the two surviving token seams:
 * - verifyTokenUid: THE identity source (authMiddleware + public reads).
 * - optionalViewerUid: optional-auth resolution for publicly readable
 *   resources. The legacy requireAuth/maybeAuth/resolveCollectionViewer trio
 *   was removed with the Phase 5 cleanup; its behaviors live on covered by
 *   tests/server/auth-middleware.test.ts (missing token → UNAUTHENTICATED,
 *   forged uid inertness) and the optionalViewerUid cases below.
 */

describe("server-auth verifyTokenUid", () => {
  beforeEach(() => {
    verifyIdToken.mockReset();
  });

  it("returns the decoded UID of a valid token", async () => {
    verifyIdToken.mockResolvedValue({ uid: "user-a" });
    await expect(verifyTokenUid("valid-token")).resolves.toBe("user-a");
    expect(verifyIdToken).toHaveBeenCalledWith("valid-token");
  });

  it("propagates verification failures to the caller", async () => {
    verifyIdToken.mockRejectedValue(new Error("Firebase ID token has expired."));
    await expect(verifyTokenUid("expired-token")).rejects.toThrow("expired");
  });
});

describe("server-auth optionalViewerUid (public-read viewer, Phase 4)", () => {
  beforeEach(() => {
    verifyIdToken.mockReset();
  });

  it("resolves null without a token and never touches verification", async () => {
    await expect(optionalViewerUid(null)).resolves.toBeNull();
    await expect(optionalViewerUid(undefined)).resolves.toBeNull();
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  it("returns the VERIFIED token UID (no claimed-UID parameter exists)", async () => {
    verifyIdToken.mockResolvedValue({ uid: "user-a" });
    await expect(optionalViewerUid("token-of-a")).resolves.toBe("user-a");
    expect(verifyIdToken).toHaveBeenCalledWith("token-of-a");
  });

  it("rejects an invalid/expired token with a curated AppError UNAUTHORIZED", async () => {
    verifyIdToken.mockRejectedValue(new Error("Firebase ID token has weird-driver-detail."));
    const err = await optionalViewerUid("expired-token").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    if (err instanceof AppError) {
      expect(err.code).toBe("UNAUTHORIZED");
      // The public message is curated; driver/verification details stay in cause.
      expect(err.message).toBe("Invalid or expired session.");
      expect(err.message).not.toContain("weird-driver-detail");
    }
  });

  it("propagates FirebaseAdminError so config failures stay 5xx-class visible", async () => {
    verifyIdToken.mockRejectedValue(new FirebaseAdminError("init", "no credentials"));
    await expect(optionalViewerUid("any-token")).rejects.toBeInstanceOf(FirebaseAdminError);
  });

  it("never leaks the raw driver message through the cause-free public surface", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const token = "SENSITIVE_ID_TOKEN_VALUE";
      verifyIdToken.mockRejectedValue(new Error(`token expired for ${token}`));
      const err = await optionalViewerUid(token).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AppError);
      // Public envelope never echoes the token value.
      expect(JSON.stringify(err)).not.toContain(token);
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
