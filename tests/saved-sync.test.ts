import { describe, it, expect, vi, beforeEach } from "vitest";
import { syncSavedForUser } from "../src/lib/saved";
import { toggleUserLike, getUserLikedIds, mergeLikedPosters } from "../src/lib/user-likes";

vi.mock("../src/lib/user-likes", () => ({
  toggleUserLike: vi.fn(),
  getUserLikedIds: vi.fn(),
  mergeLikedPosters: vi.fn(),
  getUserProfile: vi.fn(),
  updateBio: vi.fn(),
  ensureUserProfile: vi.fn(),
}));

const toggleMock = vi.mocked(toggleUserLike);
const getMock = vi.mocked(getUserLikedIds);
const mergeMock = vi.mocked(mergeLikedPosters);

const flush = () => new Promise((r) => setTimeout(r, 5));

describe("rapid save/unsave coalescing (syncSavedForUser)", () => {
  beforeEach(() => {
    toggleMock.mockReset();
    getMock.mockReset();
    mergeMock.mockReset();
    getMock.mockResolvedValue([]);
    mergeMock.mockResolvedValue(undefined);
  });

  it("a burst of same-intent toggles issues a single request", async () => {
    toggleMock.mockResolvedValue({ added: true });

    syncSavedForUser("u", "t", "p-burst", true);
    syncSavedForUser("u", "t", "p-burst", true);
    syncSavedForUser("u", "t", "p-burst", true);
    await flush();

    expect(toggleMock).toHaveBeenCalledTimes(1);
    expect(toggleMock).toHaveBeenCalledWith({
      data: { token: "t", uid: "u", posterId: "p-burst" },
    });
  });

  it("add → remove while a request is in flight is serialized (no out-of-order contradiction)", async () => {
    let resolveFirst!: (v: { added: boolean }) => void;
    toggleMock.mockImplementationOnce(
      () => new Promise<{ added: boolean }>((res) => (resolveFirst = res)),
    );
    toggleMock.mockResolvedValueOnce({ added: false });

    syncSavedForUser("u", "t", "p-serial", true); // add
    await flush();
    expect(toggleMock).toHaveBeenCalledTimes(1);

    syncSavedForUser("u", "t", "p-serial", false); // remove while first is in flight
    resolveFirst({ added: true });
    await flush();

    // Second request only fires after the first resolves, so the final server
    // state matches the user's final intent (removed).
    expect(toggleMock).toHaveBeenCalledTimes(2);
  });

  it("add → remove → add coalesces to the final saved intent", async () => {
    toggleMock.mockResolvedValue({ added: true });

    syncSavedForUser("u", "t", "p-coalesce", true);
    syncSavedForUser("u", "t", "p-coalesce", false);
    syncSavedForUser("u", "t", "p-coalesce", true);
    await flush();

    // The first request already leaves the server saved, matching the final
    // intent, so no contradictory remove/add pair is sent.
    expect(toggleMock).toHaveBeenCalledTimes(1);
  });

  it("on server failure, restores the server state via a reload", async () => {
    toggleMock.mockRejectedValueOnce(new Error("network"));
    getMock.mockResolvedValue(["p-fail"]);

    syncSavedForUser("u", "t", "p-fail", true);
    await flush();

    expect(getMock).toHaveBeenCalled();
  });
});
