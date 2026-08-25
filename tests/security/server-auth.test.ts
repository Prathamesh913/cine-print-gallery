import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  requireAuth,
  maybeAuth,
  resolveCollectionViewer,
  optionalViewerUid,
  AuthRequiredError,
  UnauthorizedError,
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

// getProjectId moved to the public client module; mock it so logs assert
// against a known value regardless of the developer's local .env.
vi.mock("../../src/lib/firebase", () => ({
  getProjectId: () => "test-project",
  db: null,
}));

describe("server-auth requireAuth", () => {
  beforeEach(() => {
    verifyIdToken.mockReset();
  });

  it("rejects requests without a token", async () => {
    await expect(requireAuth(undefined)).rejects.toBeInstanceOf(AuthRequiredError);
    await expect(requireAuth(null)).rejects.toBeInstanceOf(AuthRequiredError);
    await expect(requireAuth("")).rejects.toBeInstanceOf(AuthRequiredError);
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  it("accepts a valid token and returns the verified UID", async () => {
    verifyIdToken.mockResolvedValue({ uid: "user-a" });
    await expect(requireAuth("valid-token")).resolves.toBe("user-a");
    expect(verifyIdToken).toHaveBeenCalledWith("valid-token");
  });

  it("accepts a token when the claimed UID matches the verified UID", async () => {
    verifyIdToken.mockResolvedValue({ uid: "user-a" });
    await expect(requireAuth("valid-token", "user-a")).resolves.toBe("user-a");
  });

  it("rejects a token when the claimed UID differs from the verified UID", async () => {
    verifyIdToken.mockResolvedValue({ uid: "user-a" });
    await expect(requireAuth("token-of-a", "user-b")).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("rejects an invalid or expired token", async () => {
    verifyIdToken.mockRejectedValue(new Error("Firebase ID token has expired."));
    await expect(requireAuth("expired-token")).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("logs the underlying verification error while returning a safe public error", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      verifyIdToken.mockRejectedValue(new Error("Could not load the default credentials"));
      await expect(requireAuth("valid-looking-token")).rejects.toBeInstanceOf(UnauthorizedError);
      expect(consoleError).toHaveBeenCalled();
      const logged = consoleError.mock.calls.map((c) => c.join(" ")).join(" ");
      expect(logged).toContain("Could not load the default credentials");
      expect(logged).toContain("test-project");
    } finally {
      consoleError.mockRestore();
    }
  });

  it("never logs the token value", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const token = "SENSITIVE_ID_TOKEN_VALUE";
      verifyIdToken.mockRejectedValue(new Error("token expired"));
      await expect(requireAuth(token)).rejects.toBeInstanceOf(UnauthorizedError);
      const logged = consoleError.mock.calls.map((c) => c.join(" ")).join(" ");
      expect(logged).not.toContain(token);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("never returns the claimed UID when it differs from the verified UID", async () => {
    verifyIdToken.mockResolvedValue({ uid: "user-a" });
    await expect(requireAuth("token-of-a", "user-b")).rejects.toThrow();
  });
});

describe("server-auth maybeAuth", () => {
  beforeEach(() => {
    verifyIdToken.mockReset();
  });

  it("returns null for unauthenticated callers (public read path)", async () => {
    await expect(maybeAuth(null)).resolves.toBeNull();
    await expect(maybeAuth(undefined)).resolves.toBeNull();
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  it("returns the verified UID when a token is provided", async () => {
    verifyIdToken.mockResolvedValue({ uid: "user-a" });
    await expect(maybeAuth("valid-token")).resolves.toBe("user-a");
  });

  it("rejects a mismatched claimed UID even on the public path", async () => {
    verifyIdToken.mockResolvedValue({ uid: "user-a" });
    await expect(maybeAuth("token-of-a", "user-b")).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

describe("server-auth resolveCollectionViewer", () => {
  beforeEach(() => {
    verifyIdToken.mockReset();
  });

  it("allows an unauthenticated public preview (no token, no claimed UID)", async () => {
    await expect(resolveCollectionViewer(null, null)).resolves.toBeNull();
    await expect(resolveCollectionViewer(undefined)).resolves.toBeNull();
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  it("rejects a claimed UID without a token", async () => {
    await expect(resolveCollectionViewer(null, "user-b")).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("returns the verified UID for an authenticated viewer", async () => {
    verifyIdToken.mockResolvedValue({ uid: "user-a" });
    await expect(resolveCollectionViewer("token-of-a", "user-a")).resolves.toBe("user-a");
  });

  it("rejects a viewer claiming another user's UID", async () => {
    verifyIdToken.mockResolvedValue({ uid: "user-a" });
    await expect(resolveCollectionViewer("token-of-a", "user-b")).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
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
});
