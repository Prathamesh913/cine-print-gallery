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
    getMock.mockResolvedValue({ ok: true, data: [] });
    mergeMock.mockResolvedValue({ ok: true, data: null });
  });

  it("a burst of same-intent toggles issues a single request", async () => {
    toggleMock.mockResolvedValue({ ok: true, data: { added: true } });

    syncSavedForUser("u", "t", "p-burst", true);
    syncSavedForUser("u", "t", "p-burst", true);
    syncSavedForUser("u", "t", "p-burst", true);
    await flush();

    expect(toggleMock).toHaveBeenCalledTimes(1);
    expect(toggleMock).toHaveBeenCalledWith({
      data: { token: "t", posterId: "p-burst" },
    });
  });

  it("add → remove while a request is in flight is serialized (no out-of-order contradiction)", async () => {
    let resolveFirst!: (v: { ok: true; data: { added: boolean } }) => void;
    toggleMock.mockImplementationOnce(
      () => new Promise<{ ok: true; data: { added: boolean } }>((res) => (resolveFirst = res)),
    );
    toggleMock.mockResolvedValueOnce({ ok: true, data: { added: false } });

    syncSavedForUser("u", "t", "p-serial", true); // add
    await flush();
    expect(toggleMock).toHaveBeenCalledTimes(1);

    syncSavedForUser("u", "t", "p-serial", false); // remove while first is in flight
    resolveFirst({ ok: true, data: { added: true } });
    await flush();

    // Second request only fires after the first resolves, so the final server
    // state matches the user's final intent (removed).
    expect(toggleMock).toHaveBeenCalledTimes(2);
  });

  it("add → remove → add coalesces to the final saved intent", async () => {
    toggleMock.mockResolvedValue({ ok: true, data: { added: true } });

    syncSavedForUser("u", "t", "p-coalesce", true);
    syncSavedForUser("u", "t", "p-coalesce", false);
    syncSavedForUser("u", "t", "p-coalesce", true);
    await flush();

    // The first request already leaves the server saved, matching the final
    // intent, so no contradictory remove/add pair is sent.
    expect(toggleMock).toHaveBeenCalledTimes(1);
  });

  it("on rejected RPC, restores the server state via a reload", async () => {
    toggleMock.mockRejectedValueOnce(new Error("network"));
    getMock.mockResolvedValue({ ok: true, data: ["p-fail"] });

    syncSavedForUser("u", "t", "p-fail", true);
    await flush();

    expect(getMock).toHaveBeenCalled();
  });

  it("on resolved { ok:false } envelope, restores the server state via the same reload path", async () => {
    toggleMock.mockResolvedValueOnce({
      ok: false,
      error: { code: "INTERNAL", message: "Something went wrong. Please try again." },
    });
    getMock.mockResolvedValue({ ok: true, data: ["p-fail-env"] });

    syncSavedForUser("u", "t", "p-fail-env", true);
    await flush();

    // The reload fired — proving { ok:false } took the failure path.
    expect(getMock).toHaveBeenCalled();
  });
});
