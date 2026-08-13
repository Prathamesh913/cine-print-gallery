import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadSaved, SAVED_LOAD_ERROR } from "../src/lib/saved";
import { mergeLikedPosters, getUserLikedIds } from "../src/lib/user-likes";

vi.mock("../src/lib/user-likes", () => ({
  mergeLikedPosters: vi.fn(),
  getUserLikedIds: vi.fn(),
  toggleUserLike: vi.fn(),
  getUserProfile: vi.fn(),
  updateBio: vi.fn(),
  ensureUserProfile: vi.fn(),
}));

const mergeMock = vi.mocked(mergeLikedPosters);
const getMock = vi.mocked(getUserLikedIds);

describe("loadSaved", () => {
  beforeEach(() => {
    mergeMock.mockReset();
    getMock.mockReset();
  });

  it("successful load merges anonymous ids first and returns the account list", async () => {
    mergeMock.mockResolvedValue(undefined);
    getMock.mockResolvedValue(["a", "b"]);

    const result = await loadSaved("uid", "token", ["anon-1"]);

    expect(mergeMock).toHaveBeenCalledWith({
      data: { token: "token", uid: "uid", posterIds: ["anon-1"] },
    });
    expect(result).toEqual({ ok: true, data: ["a", "b"] });
  });

  it("successful load with no anonymous ids just reads the account list", async () => {
    getMock.mockResolvedValue(["a"]);
    const result = await loadSaved("uid", "token", []);
    expect(mergeMock).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, data: ["a"] });
  });

  it("empty successful load is not treated as an error", async () => {
    getMock.mockResolvedValue([]);
    const result = await loadSaved("uid", "token", []);
    expect(result).toEqual({ ok: true, data: [] });
  });

  it("failed load exposes an error instead of an empty success", async () => {
    getMock.mockRejectedValue(new Error("network"));
    const result = await loadSaved("uid", "token", []);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(SAVED_LOAD_ERROR);
    }
  });

  it("failed load does not destroy anonymous local data (localStorage untouched in node)", async () => {
    getMock.mockRejectedValue(new Error("network"));
    const result = await loadSaved("uid", "token", ["anon-1"]);
    expect(result.ok).toBe(false);
  });
});
