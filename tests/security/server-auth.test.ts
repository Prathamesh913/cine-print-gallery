import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  requireAuth,
  maybeAuth,
  resolveCollectionViewer,
  AuthRequiredError,
  UnauthorizedError,
} from "../../src/lib/server-auth";

const verifyIdToken = vi.fn();
vi.mock("../../src/lib/firebase", () => ({
  getAdminAuth: () => Promise.resolve({ verifyIdToken }),
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
