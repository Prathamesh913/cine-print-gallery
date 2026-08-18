import { describe, expect, it, vi } from "vitest";
import type { Auth, User } from "firebase/auth";
import { initializeAuthSession, type AuthInitializationApi } from "../src/lib/auth-initialization";

const auth = {} as Auth;
const user = { uid: "user-1" } as User;

function createApi(
  getRedirectResult: AuthInitializationApi<Auth, User>["getRedirectResult"],
  order: string[] = [],
) {
  let listener: ((nextUser: User | null) => void) | undefined;
  const api: AuthInitializationApi<Auth, User> = {
    onAuthStateChanged: vi.fn((_auth, callback) => {
      order.push("listener");
      listener = callback;
      return () => undefined;
    }),
    getRedirectResult,
  };
  return { api, emit: (nextUser: User | null) => listener?.(nextUser) };
}

describe("initializeAuthSession", () => {
  it("attaches the listener before redirect lookup and resolves logged-out state", async () => {
    const order: string[] = [];
    const api = createApi(async () => {
      order.push("redirect");
      return null;
    }, order);
    const onUser = vi.fn();
    const onReady = vi.fn();

    initializeAuthSession(auth, api.api, onUser, onReady);
    api.emit(null);
    await Promise.resolve();

    expect(order).toEqual(["listener", "redirect"]);
    expect(onUser).toHaveBeenCalledWith(null);
    expect(onReady).toHaveBeenCalledOnce();
  });

  it("resolves an authenticated state without waiting for redirect lookup", () => {
    const api = createApi(() => new Promise(() => undefined));
    const onUser = vi.fn();
    const onReady = vi.fn();

    initializeAuthSession(auth, api.api, onUser, onReady);
    api.emit(user);

    expect(onUser).toHaveBeenCalledWith(user);
    expect(onReady).toHaveBeenCalledOnce();
  });

  it("keeps the resolved logged-out state when redirect lookup fails", async () => {
    const api = createApi(async () => {
      throw new Error("redirect lookup failed");
    });
    const onUser = vi.fn();
    const onReady = vi.fn();

    initializeAuthSession(auth, api.api, onUser, onReady);
    api.emit(null);
    await Promise.resolve();

    expect(onUser).toHaveBeenCalledWith(null);
    expect(onReady).toHaveBeenCalledOnce();
  });
});
