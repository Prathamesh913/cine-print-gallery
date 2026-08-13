import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadUserProfile, prefetchUserProfile, PROFILE_LOAD_ERROR } from "../src/lib/user-profile";
import { getUserProfile } from "../src/lib/user-likes";

vi.mock("../src/lib/user-likes", () => ({
  getUserProfile: vi.fn(),
  updateBio: vi.fn(),
  getUserLikedIds: vi.fn(),
  toggleUserLike: vi.fn(),
  mergeLikedPosters: vi.fn(),
  ensureUserProfile: vi.fn(),
}));

const profileMock = vi.mocked(getUserProfile);

const baseProfile = { createdAt: "2020-01-01T00:00:00.000Z", bio: "hi" };

describe("loadUserProfile", () => {
  beforeEach(() => {
    profileMock.mockReset();
  });

  it("successful load returns the profile", async () => {
    profileMock.mockResolvedValue(baseProfile);
    await expect(loadUserProfile("uid", "token")).resolves.toEqual({ ok: true, data: baseProfile });
  });

  it("failed load exposes an error", async () => {
    profileMock.mockRejectedValue(new Error("boom"));
    const result = await loadUserProfile("uid", "token");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(PROFILE_LOAD_ERROR);
    }
  });
});

describe("prefetchUserProfile", () => {
  beforeEach(() => {
    profileMock.mockReset();
  });

  it("successful prefetch returns the profile", async () => {
    profileMock.mockResolvedValue(baseProfile);
    await expect(prefetchUserProfile("uid", "token")).resolves.toEqual(baseProfile);
  });

  it("failed prefetch returns the previously cached profile (data preserved)", async () => {
    profileMock.mockResolvedValueOnce(baseProfile);
    await prefetchUserProfile("uid", "token");

    profileMock.mockRejectedValueOnce(new Error("boom"));
    const result = await prefetchUserProfile("uid", "token");
    // The full cached entry (including uid) is preserved on failure.
    expect(result).toEqual({ uid: "uid", ...baseProfile });
  });

  it("failed prefetch with no prior data returns null (no fake empty profile)", async () => {
    profileMock.mockRejectedValue(new Error("boom"));
    await expect(prefetchUserProfile("new-user", "token")).resolves.toBeNull();
  });

  it("retry after a failure succeeds", async () => {
    profileMock.mockRejectedValueOnce(new Error("boom"));
    await prefetchUserProfile("uid", "token");

    const retried = { ...baseProfile, bio: "updated" };
    profileMock.mockResolvedValueOnce(retried);
    await expect(prefetchUserProfile("uid", "token")).resolves.toEqual(retried);
  });
});
