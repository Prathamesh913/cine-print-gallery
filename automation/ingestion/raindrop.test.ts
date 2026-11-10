import { describe, expect, it, vi } from "vitest";
import {
  RaindropApiError,
  RaindropAuthError,
  RaindropRateLimitError,
  fetchRaindropBookmarks,
} from "./raindrop";

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function bookmark(id: number) {
  return {
    _id: id,
    tags: ["movie:Test|2020", "artist:Someone"],
    link: `https://example.com/${id}`,
  };
}

describe("Raindrop source", () => {
  it("fetches newest-first pages until a short page", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: URL | RequestInfo) => {
      calls.push(String(url));
      const page = new URL(String(url)).searchParams.get("page");
      return page === "0"
        ? jsonResponse({ items: [bookmark(1), bookmark(2)], count: 3 })
        : jsonResponse({ items: [bookmark(3)], count: 3 });
    });

    const result = await fetchRaindropBookmarks({
      accessToken: "token",
      collectionId: "42",
      pageSize: 2,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: async () => undefined,
    });

    expect(result.bookmarks.map((item) => item._id)).toEqual([1, 2, 3]);
    expect(result.pagesFetched).toBe(2);
    expect(result.totalCount).toBe(3);
    expect(result.truncated).toBe(false);
    expect(calls[0]).toContain("sort=-created");
    expect(calls[0]).toContain("perpage=2");
  });

  it("honours Retry-After on a rate limit and then succeeds", async () => {
    const sleep = vi.fn(async () => undefined);
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return jsonResponse({ error: "rate" }, 429, { "retry-after": "2" });
      }
      return jsonResponse({ items: [bookmark(1)], count: 1 });
    });

    const result = await fetchRaindropBookmarks({
      accessToken: "token",
      collectionId: "42",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: sleep,
    });

    expect(result.bookmarks).toHaveLength(1);
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it("fails with a rate-limit error once retries are exhausted", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 429, { "retry-after": "0" }));

    await expect(
      fetchRaindropBookmarks({
        accessToken: "token",
        collectionId: "42",
        retries: 2,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleepImpl: async () => undefined,
      }),
    ).rejects.toBeInstanceOf(RaindropRateLimitError);
  });

  it("retries server errors and fails after the attempt budget", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 503));

    await expect(
      fetchRaindropBookmarks({
        accessToken: "token",
        collectionId: "42",
        retries: 1,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleepImpl: async () => undefined,
      }),
    ).rejects.toBeInstanceOf(RaindropApiError);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("never retries an authentication failure", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 401));

    await expect(
      fetchRaindropBookmarks({
        accessToken: "bad",
        collectionId: "42",
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleepImpl: async () => undefined,
      }),
    ).rejects.toBeInstanceOf(RaindropAuthError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries a network failure and surfaces a transport error", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });

    await expect(
      fetchRaindropBookmarks({
        accessToken: "token",
        collectionId: "42",
        retries: 1,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleepImpl: async () => undefined,
      }),
    ).rejects.toMatchObject({ status: 0 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("marks truncated when the page cap is reached", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ items: [bookmark(1), bookmark(2)], count: 100 }),
    );

    const result = await fetchRaindropBookmarks({
      accessToken: "token",
      collectionId: "42",
      pageSize: 2,
      maxPages: 1,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: async () => undefined,
    });

    expect(result.truncated).toBe(true);
    expect(result.pagesFetched).toBe(1);
  });

  it("rejects an invalid JSON body", async () => {
    const fetchImpl = vi.fn(async () => new Response("<html>", { status: 200 }));

    await expect(
      fetchRaindropBookmarks({
        accessToken: "token",
        collectionId: "42",
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleepImpl: async () => undefined,
      }),
    ).rejects.toThrow("invalid JSON");
  });
});
