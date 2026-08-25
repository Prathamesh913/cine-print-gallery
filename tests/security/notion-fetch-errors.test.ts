import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression: infrastructure failures in loadPublishedPosters must NOT become [].
 * The gallery UI treats [] as a genuine empty catalog ("No posters found"),
 * which previously hid Firebase Admin module-load / init failures behind a
 * misleading configuration message.
 */

const adminRequireState = vi.hoisted(() => ({
  impl: null as ((id: string) => unknown) | null,
}));

vi.mock("node:module", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:module")>();
  return {
    ...actual,
    createRequire: () => {
      return (id: string) => {
        if (!adminRequireState.impl) {
          throw new Error(`Cannot find module '${id}'`);
        }
        return adminRequireState.impl(id);
      };
    },
  };
});

const VALID_SA = {
  type: "service_account",
  project_id: "test-proj",
  private_key_id: "kid",
  private_key: "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n",
  client_email: "admin@test-proj.iam.gserviceaccount.com",
};

const ENV_KEYS = ["FIREBASE_SERVICE_ACCOUNT_JSON", "FIREBASE_PROJECT_ID"] as const;

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  adminRequireState.impl = null;
  vi.resetModules();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.restoreAllMocks();
});

describe("loadPublishedPosters error handling", () => {
  it("does not return [] when Firebase Admin module-load fails", async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify(VALID_SA);
    adminRequireState.impl = null;
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { loadPublishedPosters, _resetPosterCacheForTests } = await import(
      "../../src/lib/notion"
    );
    _resetPosterCacheForTests();

    const err = await loadPublishedPosters().then(
      () => null,
      (e: unknown) => e as Error,
    );

    expect(err).not.toBeNull();
    expect(err?.name).toBe("PosterFetchError");
    expect(err?.message).not.toMatch(/private_key|BEGIN PRIVATE|service.account/i);
    expect(err?.message).not.toContain("firebase-admin/app");
  });

  it("returns [] only for a genuine empty published-poster query", async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify(VALID_SA);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});

    const fakeCollection = {
      where: () => ({
        get: async () => ({ docs: [] }),
      }),
    };
    const fakeDb = {
      collection: () => fakeCollection,
    };

    adminRequireState.impl = (id: string) => {
      switch (id) {
        case "firebase-admin/app":
          return {
            initializeApp: () => ({ __fakeApp: true }),
            getApps: () => [],
            cert: () => ({ __cert: true }),
          };
        case "firebase-admin/firestore":
          return {
            getFirestore: () => fakeDb,
            FieldValue: {
              serverTimestamp: () => "TS",
              arrayUnion: (...a: unknown[]) => a,
              arrayRemove: (...a: unknown[]) => a,
            },
            Timestamp: { fromDate: (d: Date) => d },
          };
        case "firebase-admin/auth":
          return { getAuth: () => ({}) };
        default:
          throw new Error(`Cannot find module '${id}'`);
      }
    };

    const { loadPublishedPosters, _resetPosterCacheForTests } = await import(
      "../../src/lib/notion"
    );
    _resetPosterCacheForTests();
    const result = await loadPublishedPosters();
    expect(result).toEqual([]);
  });

  it("does not return [] when the Firestore query itself throws", async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify(VALID_SA);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});

    const fakeDb = {
      collection: () => ({
        where: () => ({
          get: async () => {
            throw new Error("UNAVAILABLE: Firestore backend offline");
          },
        }),
      }),
    };

    adminRequireState.impl = (id: string) => {
      if (id === "firebase-admin/app") {
        return {
          initializeApp: () => ({ __fakeApp: true }),
          getApps: () => [],
          cert: () => ({ __cert: true }),
        };
      }
      if (id === "firebase-admin/firestore") {
        return { getFirestore: () => fakeDb };
      }
      throw new Error(`Cannot find module '${id}'`);
    };

    const { loadPublishedPosters, _resetPosterCacheForTests } = await import(
      "../../src/lib/notion"
    );
    _resetPosterCacheForTests();

    const err = await loadPublishedPosters().then(
      () => null,
      (e: unknown) => e as Error,
    );

    expect(err?.name).toBe("PosterFetchError");
    expect(err?.message).not.toContain("UNAVAILABLE");
  });
});
