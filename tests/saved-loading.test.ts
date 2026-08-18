import { beforeEach, describe, expect, it, vi } from "vitest";

const effects: Array<() => void | (() => void)> = [];
const getAuthTokenMock = vi.fn();
const getUserLikedIdsMock = vi.fn();

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useEffect: (effect: () => void | (() => void)) => {
      effects.push(effect);
    },
    useCallback: <T extends (...args: never[]) => unknown>(callback: T) => callback,
    useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
  };
});

vi.mock("../src/lib/auth", () => ({
  useAuth: () => ({
    user: { uid: "uid" },
    loading: false,
  }),
}));

vi.mock("../src/lib/auth-token", () => ({
  getAuthToken: getAuthTokenMock,
}));

vi.mock("../src/lib/user-likes", () => ({
  getUserLikedIds: getUserLikedIdsMock,
  mergeLikedPosters: vi.fn(),
  toggleUserLike: vi.fn(),
}));

describe("useSaved authenticated loading", () => {
  beforeEach(() => {
    vi.resetModules();
    effects.length = 0;
    getAuthTokenMock.mockReset();
    getUserLikedIdsMock.mockReset();
  });

  it("starts the saved request after auth resolves instead of deadlocking in loading", async () => {
    getAuthTokenMock.mockResolvedValue("token");
    getUserLikedIdsMock.mockResolvedValue(["poster-1"]);

    const { useSaved } = await import("../src/lib/saved");
    const state = useSaved();

    // Auth is known, but the account request has not completed yet.
    expect(state.loading).toBe(true);
    expect(effects).toHaveLength(1);

    effects[0]?.();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(getAuthTokenMock).toHaveBeenCalledOnce();
    expect(getUserLikedIdsMock).toHaveBeenCalledWith({ data: { token: "token", uid: "uid" } });
  });
});
