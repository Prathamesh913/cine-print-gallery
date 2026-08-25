import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression: infrastructure failures in loadPublishedPosters must NOT become [].
 * The gallery UI treats [] as a genuine empty catalog ("No posters found"),
 * which previously hid server-side failures behind a misleading
 * configuration message.
 *
 * C0 note: the public poster path uses the PUBLIC Firestore client SDK
 * (rules: /posters read = true) — these tests mock src/lib/firebase's `db`
 * rather than the Admin module, which is no longer on this path at all.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FakeSnapshot = { docs: Array<{ id: string; data: () => Record<string, unknown> }> };

const firestoreState = vi.hoisted(() => ({
  docs: [] as Array<{ id: string; data: () => Record<string, unknown> }>,
  failGetDocs: null as ((err?: unknown) => void) | null,
}));

vi.mock("firebase/firestore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("firebase/firestore")>();
  return {
    ...actual,
    collection: () => "posters-collection",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query: (..._args: any[]) => "published-query",
    where: () => "status==published",
    getDocs: async (): Promise<FakeSnapshot> => {
      if (firestoreState.failGetDocs) {
        const fn = firestoreState.failGetDocs;
        firestoreState.failGetDocs = null;
        fn();
      }
      return { docs: firestoreState.docs };
    },
  };
});

const firebaseState = vi.hoisted(() => ({
  db: { __publicClientDb: true } as unknown,
}));

vi.mock("../../src/lib/firebase", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get db() {
    return firebaseState.db;
  },
  getProjectId: () => "test-proj",
}));

const ENV_KEYS = ["FIREBASE_SERVICE_ACCOUNT_JSON", "FIREBASE_PROJECT_ID"] as const;

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  firestoreState.docs = [];
  firestoreState.failGetDocs = null;
  firebaseState.db = { __publicClientDb: true };
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.restoreAllMocks();
});

describe("loadPublishedPosters error handling (public SDK path)", () => {
  it("returns [] only for a genuine empty published-poster query", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { loadPublishedPosters, _resetPosterCacheForTests } = await import(
      "../../src/lib/notion"
    );
    _resetPosterCacheForTests();

    await expect(loadPublishedPosters()).resolves.toEqual([]);
  });

  it("does not return [] when the Firestore query itself throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { loadPublishedPosters, _resetPosterCacheForTests } = await import(
      "../../src/lib/notion"
    );
    _resetPosterCacheForTests();
    firestoreState.failGetDocs = () => {
      throw new Error("UNAVAILABLE: Firestore backend offline");
    };

    const err = await loadPublishedPosters().then(
      () => null,
      (e: unknown) => e as Error,
    );

    expect(err?.name).toBe("PosterFetchError");
    expect(err?.message).not.toContain("UNAVAILABLE");
  });

  it("does not return [] when the public db failed to initialize", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { loadPublishedPosters, _resetPosterCacheForTests } = await import(
      "../../src/lib/notion"
    );
    _resetPosterCacheForTests();
    firebaseState.db = null;

    const err = await loadPublishedPosters().then(
      () => null,
      (e: unknown) => e as Error,
    );

    expect(err?.name).toBe("PosterFetchError");
  });

  it("maps real poster rows to Poster objects and caches the result", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { loadPublishedPosters, _resetPosterCacheForTests } = await import(
      "../../src/lib/notion"
    );
    _resetPosterCacheForTests();
    firestoreState.docs = [
      { id: "p1", data: () => ({ title: "Dune", artist: "A", image: "https://x/y.jpg", year: 1984 }) },
    ];

    const first = await loadPublishedPosters();
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ id: "p1", title: "Dune" });
  });
});
